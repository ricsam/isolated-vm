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

			return {
				hasAsyncContext: typeof AsyncContext === "object",
				name: variable.name,
				defaultValue: variable.get(),
				parallel: await Promise.all([promiseA, promiseB]),
				nestedValue,
				snapshotValue,
			};
		})()
	`, {
		copy: true,
		promise: true,
	});

	assert.deepStrictEqual(result, {
		hasAsyncContext: true,
		name: 'requestId',
		defaultValue: 'unset',
		parallel: ['A', 'B'],
		nestedValue: 'outer',
		snapshotValue: 'snapshot',
	});

	context.release();
	enabledIsolate.dispose();
	console.log('pass');
})().catch((error) => {
	console.error(error && error.stack ? error.stack : error);
	process.exit(1);
});
