const vm = require('vm')
const path = require('path')
const NativeModule = require('module')

const resolve = require('resolve')

const _toString = Object.prototype.toString

const isPlainObject = obj => _toString.call(obj) === '[object Object]'

function createSandbox(context, CONTEXT_KEY) {
  const sandbox = {
    Buffer,
    console,
    process,
    setTimeout,
    setInterval,
    setImmediate,
    clearTimeout,
    clearInterval,
    clearImmediate,
    [CONTEXT_KEY]: context,
  }
  sandbox.global = sandbox
  return sandbox
}

function compileModule(files, basedir, runInNewContext) {
  const compiledScripts = {}
  const resolvedModules = {}

  function getCompiledScript(filename) {
    if (compiledScripts[filename]) {
      return compiledScripts[filename]
    }
    const code = files[filename]
    const wrapper = NativeModule.wrap(code)
    const script = new vm.Script(wrapper, {
      filename,
      displayErrors: true,
    })
    compiledScripts[filename] = script
    return script
  }

  function evaluateModule(filename, sandbox, evaluatedFiles = {}) {
    if (evaluatedFiles[filename]) {
      return evaluatedFiles[filename]
    }

    const script = getCompiledScript(filename)
    const compiledWrapper =
      runInNewContext === false
        ? script.runInThisContext()
        : script.runInNewContext(sandbox)
    const m = { exports: {} }
    const r = file => {
      file = path.posix.join('.', file)
      if (files[file]) {
        return evaluateModule(file, sandbox, evaluatedFiles)
      } else if (basedir) {
        return require(resolvedModules[file] ||
          (resolvedModules[file] = resolve.sync(file, { basedir })))
      } else {
        return require(file)
      }
    }
    compiledWrapper.call(m.exports, m.exports, r, m)

    const res = Object.prototype.hasOwnProperty.call(m.exports, 'default')
      ? m.exports.default
      : m.exports
    evaluatedFiles[filename] = res
    return res
  }
  return evaluateModule
}

function deepClone(val) {
  if (isPlainObject(val)) {
    const res = {}
    for (const key in val) {
      res[key] = deepClone(val[key])
    }
    return res
  } else if (Array.isArray(val)) {
    return val.slice()
  } else {
    return val
  }
}

let DEFAULT_CONTEXT_KEY

try {
  require('react-style-loader')
  DEFAULT_CONTEXT_KEY = '__REACT_SSR_CONTEXT__'
} catch (e) {
  try {
    require('vue-style-loader')
    DEFAULT_CONTEXT_KEY = '__VUE_SSR_CONTEXT__'
  } catch (e) {
    DEFAULT_CONTEXT_KEY = '__SSR_CONTEXT__'
  }
}

function createBundleRunner(
  entry,
  files,
  basedir,
  runInNewContext,
  CONTEXT_KEY,
) {
  const evaluate = compileModule(files, basedir, runInNewContext)
  if (runInNewContext !== false && runInNewContext !== 'once') {
    // new context mode: creates a fresh context and re-evaluate the bundle
    // on each render. Ensures entire application state is fresh for each
    // render, but incurs extra evaluation cost.
    return (userContext = {}) =>
      new Promise(resolve => {
        userContext._registeredComponents = new Set()
        const res = evaluate(entry, createSandbox(userContext, CONTEXT_KEY))
        resolve(typeof res === 'function' ? res(userContext) : res)
      })
  } else {
    // direct mode: instead of re-evaluating the whole bundle on
    // each render, it simply calls the exported function. This avoids the
    // module evaluation costs but requires the source code to be structured
    // slightly differently.
    let runner // lazy creation so that errors can be caught by user
    let initialContext
    return (userContext = {}) =>
      new Promise(resolve => {
        if (!runner) {
          const sandbox = runInNewContext === 'once' ? createSandbox() : global
          // the initial context is only used for collecting possible non-component
          // styles injected by react/vue-style-loader.
          initialContext = sandbox[CONTEXT_KEY] = {}
          runner = evaluate(entry, sandbox)
          // On subsequent renders, CONTEXT_KEY will not be available
          // to prevent cross-request pollution.
          delete sandbox[CONTEXT_KEY]
          if (typeof runner !== 'function') {
            throw new Error(
              'bundle export should be a function when using ' +
                '{ runInNewContext: false }.',
            )
          }
        }

        userContext._registeredComponents = new Set()

        // react/vue-style-loader styles imported outside of component lifecycle hooks
        if (initialContext._styles) {
          userContext._styles = deepClone(initialContext._styles)
          // #6353 ensure "styles" is exposed even if no styles are injected
          // in component lifecycles.
          // the renderStyles fn is exposed by react/vue-style-loader
          const renderStyles = initialContext._renderStyles
          if (renderStyles) {
            Object.defineProperty(userContext, 'styles', {
              enumerable: true,
              get() {
                return renderStyles(userContext._styles)
              },
            })
          }
        }

        resolve(runner(userContext))
      })
  }
}

module.exports = (
  { bundle: { entry, files }, basedir, runInNewContext },
  CONTEXT_KEY = DEFAULT_CONTEXT_KEY,
) => createBundleRunner(entry, files, basedir, runInNewContext, CONTEXT_KEY)
