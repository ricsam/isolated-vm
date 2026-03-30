'use strict';
const assert = require('assert');
const ivm = require('..');

(async () => {
	const isolate = new ivm.Isolate();
	const disabledContext = await isolate.createContext();
	const hasAsyncContextWithoutOptIn = await disabledContext.eval(
		`typeof AsyncContext`,
		{ copy: true, promise: true }
	);
	assert.strictEqual(hasAsyncContextWithoutOptIn, 'undefined');
	const hasPromiseHooksWithoutOptIn = await disabledContext.eval(
		`typeof globalThis.__ivmAsyncContextInternal?.setPromiseHooks`,
		{ copy: true, promise: true }
	);
	assert.strictEqual(hasPromiseHooksWithoutOptIn, 'undefined');
	disabledContext.release();
	isolate.dispose();

	const enabledIsolate = new ivm.Isolate();
	const context = await enabledIsolate.createContext({ asyncContext: true });
	const result = await context.eval(`
		(async () => {
			const variable = new AsyncContext.Variable({
				name: "requestId",
				defaultValue: "unset",
			});

			const deferred = (() => {
				let resolve;
				const promise = new Promise((resolvePromise) => {
					resolve = resolvePromise;
				});
				return { promise, resolve };
			})();
			const hookEvents = [];
			__ivmAsyncContextInternal.setPromiseHooks(
				(promise, parent) => {
					hookEvents.push({
						event: "init",
						hasParent: parent instanceof Promise,
						isPromise: promise instanceof Promise,
					});
				},
				() => {
					hookEvents.push({ event: "before" });
				},
				() => {
					hookEvents.push({ event: "after" });
				},
				() => {
					hookEvents.push({ event: "resolve" });
				},
			);

			const promiseA = variable.run("A", async () => {
				await deferred.promise;
				return variable.get();
			});
			const promiseB = variable.run("B", async () => {
				deferred.resolve();
				await Promise.resolve();
				return variable.get();
			});

			const nestedValue = await variable.run("outer", async () => {
				try {
					await variable.run("inner", async () => {
						await Promise.resolve();
						throw new Error("boom");
					});
				} catch {}
				await Promise.resolve();
				return variable.get();
			});

			const snapshotValue = await variable.run("snapshot", async () => {
				const snapshot = new AsyncContext.Snapshot();
				await Promise.resolve();
				return snapshot.run(async () => {
					await Promise.resolve();
					return variable.get();
				});
			});

			await Promise.resolve().then(() => "hook");
			__ivmAsyncContextInternal.setPromiseHooks(undefined, undefined, undefined, undefined);

			return {
				hasAsyncContext: typeof AsyncContext === "object",
				hasSetPromiseHooks: typeof __ivmAsyncContextInternal?.setPromiseHooks === "function",
				name: variable.name,
				defaultValue: variable.get(),
				parallel: await Promise.all([promiseA, promiseB]),
				nestedValue,
				snapshotValue,
				hookEvents,
			};
		})()
	`, {
		copy: true,
		promise: true,
	});

	assert.deepStrictEqual(result, {
		hasAsyncContext: true,
		hasSetPromiseHooks: true,
		name: 'requestId',
		defaultValue: 'unset',
		parallel: ['A', 'B'],
		nestedValue: 'outer',
		snapshotValue: 'snapshot',
		hookEvents: result.hookEvents,
	});
	assert.ok(result.hookEvents.some((event) => event.event === 'init' && event.isPromise === true));
	assert.ok(result.hookEvents.some((event) => event.event === 'before'));
	assert.ok(result.hookEvents.some((event) => event.event === 'after'));
	assert.ok(result.hookEvents.some((event) => event.event === 'resolve'));

	context.release();
	enabledIsolate.dispose();
	console.log('pass');
})().catch((error) => {
	console.error(error && error.stack ? error.stack : error);
	process.exit(1);
});
