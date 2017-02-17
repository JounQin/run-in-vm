const NativeModule = require('module')
const vm = require('vm')
const path = require('path')

function createContext(context, CONTEXT_KEY) {
  const sandbox = {
    Buffer,
    clearImmediate,
    clearInterval,
    clearTimeout,
    setImmediate,
    setInterval,
    setTimeout,
    console,
    process,
    [CONTEXT_KEY]: context
  }
  sandbox.global = sandbox
  return sandbox
}

function evaluateModule(filename, files, context, evaluatedModules) {
  if (evaluatedModules[filename]) {
    return evaluatedModules[filename]
  }

  const code = files[filename]
  const wrapper = NativeModule.wrap(code)
  const compiledWrapper = vm.runInNewContext(wrapper, context, {
    filename,
    displayErrors: true
  })
  const m = {exports: {}}
  const r = file => {
    file = path.join('.', file)
    if (files[file]) {
      return evaluateModule(file, files, context, evaluatedModules)
    } else {
      return require(file)
    }
  }
  compiledWrapper.call(m.exports, m.exports, r, m)

  const res = Object.prototype.hasOwnProperty.call(m.exports, 'default') ?
    m.exports.default :
    m.exports
  evaluatedModules[filename] = res
  return res
}

let DEFAULT_CONTEXT_KEY

try {
  require('react-style-loader')
  DEFAULT_CONTEXT_KEY = '__REACT_SSR_CONTEXT__'
} catch (e) {
  try {
    require('vue-style-loader')
    DEFAULT_CONTEXT_KEY = '__VUE_SSR_CONTEXT__'
  } catch (e) {}
}

module.exports = function runInVm({entry, files}, _context = {}, CONTEXT_KEY = DEFAULT_CONTEXT_KEY) {
  return new Promise(resolve => {
    const context = createContext(_context, CONTEXT_KEY)
    const res = evaluateModule(entry, files, context, {})
    resolve(typeof res === 'function' ? res(_context) : res)
  })
}
