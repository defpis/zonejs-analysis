/* eslint-disable */
const g: {[key: string]: any} = global;

class Zone {
  // 标识创建的zone实例
  static index = 0;

  static bindArguments(args: IArguments) {
    for (let i = args.length - 1; i >= 0; i--) {
      if (typeof args[i] === 'function') {
        args[i] = g.zone.bind(args[i]);
      }
    }
    return args;
  }

  static patchFn(obj: any, fnNames: any) {
    fnNames.forEach((name: string) => {
      const delegate = obj[name];
      if (delegate) {
        g.zone[name] = function () {
          return delegate.apply(obj, Zone.bindArguments(arguments))
        }
        obj[name] = function () {
          return g.zone[name].apply(this, arguments);
        }
      }
    });
  }

  constructor(public parentZone: Zone | null = null, public ZoneSpec: any = {}) {
    const zone = parentZone ? Object.create(parentZone) : this;
    zone.index = ++Zone.index;
    zone.parentZone = parentZone;
    Object.keys(ZoneSpec).forEach(key => {
      zone[key] = ZoneSpec[key];
    })
    return zone;
  }

  fork(ZoneSpec: any = {}): Zone {
    return new Zone(this, ZoneSpec);
  }

  run(
    fn: {apply: (arg0: any, arg1: any) => any},
    applyTo: any,
    applyWith: IArguments,
  ): any {
    const oldZone = g.zone;
    g.zone = this;
    let result;
    try {
      if (g.zone.onEnter) {
        g.zone.onEnter();
      }
      result = fn.apply(applyTo, applyWith);
    } catch (e) {
      console.error(e);
    } finally {
      if (g.zone.onLeave) {
        g.zone.onLeave();
      }
      g.zone = oldZone;
    }
    return result;
  }

  bind(fn: {apply: (arg0: any, arg1: any) => any}) {
    const zone = this.fork();
    return function ZoneBoundFn(this: Zone): any {
      return zone.run(fn, this, arguments);
    };
  }
}

const rootZone = (g.zone = new Zone());

const _setTimeout = g.setTimeout;
Zone.patchFn(g, ['setTimeout']);


let totalTime = 0;
const zoneA: any = rootZone.fork({
  onEnter() {
    this.startTime = new Date().getTime();
  },
  onLeave() {
    const time = (new Date()).getTime() - this.startTime
    console.log(`Took: ${time}ms`);
    totalTime += time;
  }
});

function main() {
  console.log('start...');
  setTimeout(() => {
    workFn('work1');
    setTimeout(() => {
      workFn('work2');
      setTimeout(() => {
        workFn('work3');
      }, 1000)
    }, 1000)
  }, 1000);

  _setTimeout(() => {
    console.log(`totalTime: ${totalTime}ms`);
  }, 5000);

  function workFn(msg: string) {
    console.log(msg);
    new Array(1000000).forEach(n => {
      Math.sqrt(n);
    })
  }
}

zoneA.run(main);