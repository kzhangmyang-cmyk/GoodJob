import { strict as assert } from "node:assert";
import type { PrivateDomainRuntimeApi } from "./runtime-api";
import { createPrivateDomainController } from "./controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const customer = {
  id: "customer-1",
  company: "真实客户",
  country: "中国",
  contact: "王总",
  ownerId: "owner-1",
  teamId: "team-1",
  stage: "待首次跟进",
  amount: 12_880,
  health: 80,
  grade: "A" as const,
  nextReminder: "2026-08-08T09:00:00.000Z",
  wecomBound: false,
  activities: []
};
const todo = {
  id: "todo-1",
  title: "首次跟进",
  type: "customer",
  priority: "high" as const,
  status: "pending" as const,
  dueAt: "2026-08-08T09:00:00.000Z",
  ownerId: "owner-1",
  teamId: "team-1",
  related: "真实客户",
  done: false,
  customerId: "customer-1",
  leadId: "lead-1"
};

{
  const main = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  const inspector = { innerHTML: "" };
  const api = {
    async getCustomers() {
      return [customer, { ...customer, id: "customer-2", company: "第二客户" }];
    },
    async getTodos() {
      return [todo];
    }
  } satisfies PrivateDomainRuntimeApi;
  const controller = createPrivateDomainController({
    api,
    main: main as unknown as HTMLElement,
    inspector: inspector as unknown as HTMLElement
  });
  await controller.open("customer-2");
  assert.equal(controller.getState().status, "ready");
  assert.equal(controller.getState().selectedCustomerId, "customer-2");
  assert.match(main.innerHTML, /第二客户/);
  controller.selectCustomer("customer-1");
  assert.equal(controller.getState().selectedCustomerId, "customer-1");
  assert.match(inspector.innerHTML, /todo-1/);
  controller.destroy();
}

{
  let fail = false;
  const api = {
    async getCustomers() {
      if (fail) throw new Error("客户读取失败");
      return [customer];
    },
    async getTodos() {
      return [todo];
    }
  } satisfies PrivateDomainRuntimeApi;
  const controller = createPrivateDomainController({ api });
  await controller.open();
  fail = true;
  await assert.rejects(() => controller.open(), /客户读取失败/);
  assert.equal(controller.getState().customers.length, 1);
  assert.equal(controller.getState().status, "error");
  controller.destroy();
}

{
  const oldCustomers = deferred<typeof customer[]>();
  const oldTodos = deferred<typeof todo[]>();
  let generation = 0;
  const api = {
    getCustomers() {
      generation += 1;
      return generation === 1
        ? oldCustomers.promise
        : Promise.resolve([{ ...customer, id: "customer-new" }]);
    },
    getTodos() {
      return generation === 1 ? oldTodos.promise : Promise.resolve([todo]);
    }
  } satisfies PrivateDomainRuntimeApi;
  const controller = createPrivateDomainController({ api });
  const oldRequest = controller.open();
  const newRequest = controller.open("customer-new");
  await newRequest;
  oldCustomers.resolve([customer]);
  oldTodos.resolve([todo]);
  await oldRequest;
  assert.equal(controller.getState().selectedCustomerId, "customer-new");
  controller.destroy();
}

{
  const customersRequest = deferred<typeof customer[]>();
  const todosRequest = deferred<typeof todo[]>();
  const main = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  const inspector = { innerHTML: "" };
  const controller = createPrivateDomainController({
    api: {
      getCustomers: () => customersRequest.promise,
      getTodos: () => todosRequest.promise
    },
    main: main as unknown as HTMLElement,
    inspector: inspector as unknown as HTMLElement
  });
  const pending = controller.open();
  controller.deactivate();
  main.innerHTML = "<h2>数据看板</h2>";
  inspector.innerHTML = "<p>看板摘要</p>";
  customersRequest.resolve([customer]);
  todosRequest.resolve([todo]);
  await pending;
  assert.equal(main.innerHTML, "<h2>数据看板</h2>");
  assert.equal(inspector.innerHTML, "<p>看板摘要</p>");
  controller.destroy();
}
