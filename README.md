# zonejs原理解析

至从接触了Angualr2+之后，就从各种博客中了解到Angular2+使用了zone.js追踪异步操作，通过类似某些语言中本地线程存储(`thread-local storage`)的方式，在任意异步操作中访问相同数据。

作为之前的Flask重度开发者，本地线程存储这个概念并不陌生，Flask中的current_app, request, g对象等都是通过Werkzeug包提供的LocalStack和LocalProxy实现了本地线程存储，对比Django在视图函数中传递请求上下文对象无疑更加优雅。

但是它们之间也有一些区别：Flask实现了上下文在不同线程之间的切换；zone.js实现了上下文在异步代码中的持久化传递。

<!-- more -->
为了探究zone.js的实现，我阅读了v0.1.0版本的源码，从中窥探到了一些核心原理，通过下面构建`simple-zone`示例分享给大家。

首先根据[`Minimal TypeScript setup for curious minds`](https://bobaekang.com/blog/minimal-typescript-project-setup-for-curious-minds/)这篇文章构建一个TypeScript的最小开发环境

```bash
.
├── README.md
├── node_modules
├── package-lock.json
├── package.json
├── src
│   └── index.ts
├── test
└── tsconfig.json
```

```typescript
// src/index.ts
console.log('Hello World!');
```

```bash
➜ npm run serve

Hello World!
```

这样环境就算搭建好了

开始构建zone.js，首先它一定是一个class对象，可以传递父zone来构建，也可以传递一些配置，额外绑定一个静态属性index来标识创建的zone实例。

```typescript
class Zone {
  // 标识创建的zone实例
  static index = 0;

  constructor(public parentZone: Zone | null = null, public ZoneSpec = {}) {
    // 如果传递了parentZone，以parentZone为原型对象创建空对象
    const zone = parentZone ? Object.create(parentZone) : this;
    zone.index = ++Zone.index;
    zone.parentZone = parentZone;
    Object.keys(ZoneSpec).forEach(key => {
      zone[key] = ZoneSpec[key];
    })
    return zone;
  }
}

const rootZone = new Zone();
console.log(rootZone); // => Zone { parentZone: null, ZoneSpec: {}, index: 1 }
```

然后实现各个基础方法

```typescript
// 在node中执行，全局对象为global
const g: { [key: string]: any } = global;

class Zone{
  // ...

  // 以当前zone实例为原型，构造一个新的zone
  fork(spec = {}) {
    return new Zone(this, spec);
  }
  // 切换上下文执行回调函数
  run(
    fn: { apply: (arg0: any, arg1: any) => any },
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
  // 使用zone包裹函数执行
  bind(fn: {apply: (arg0: any, arg1: any) => any}) {
    // 闭包了一个与同步执行顺序有关的zone实例
    const zone = this.fork();
    return function ZoneBoundFn(this: Zone): any {
      return zone.run(fn, this, arguments);
    };
  }
}

// 绑定rootZone到全局
const rootZone = (g.zone = new Zone());
console.log(rootZone);
```

接下来就是zone.js黑科技的地方了，通过patch global.settimeout举例

```typescript
class Zone{
  // 修改异步函数(eg: settimeout)的回调函数
  // 使异步回调函数被当前g.zone包裹执行
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
      // 使原有的方法在zone下执行
      // 并且收集方法到rootZone
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
}

// 保存原始setTimeout
const _setTimeout = g.setTimeout;
// 替换为zone执行的方法
Zone.patchFn(g, ['setTimeout']);
```

最后通过我们实现的Zone来统计一下多个异步任务的总执行时间

```typescript
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
```

执行得到

```bash
➜ npm run serve

start...
Took: 2ms
work1
Took: 14ms
work2
Took: 14ms
work3
Took: 20ms
totalTime: 50ms
```

总结：通过闭包和原型链的使用关联了同步和异步代码，持久化传递了执行上下文。

本文源码：https://github.com/defpis/zonejs-analysis
