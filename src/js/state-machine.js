export class StateMachine {
  constructor() {
    this._state = 'idle';
    this._listeners = {};
  }

  setState(newState) {
    const old = this._state;
    this._state = newState;
    this._emit('stateChange', newState, old);
  }

  getState() {
    return this._state;
  }

  on(eventName, fn) {
    (this._listeners[eventName] = this._listeners[eventName] || []).push(fn);
  }

  _emit(eventName, ...args) {
    (this._listeners[eventName] || []).forEach(fn => {
      try { fn(...args); } catch (e) { console.error('state-machine listener error', e); }
    });
  }
}