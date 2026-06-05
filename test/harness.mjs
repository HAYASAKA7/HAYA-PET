const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export async function runRegisteredTests() {
  let failed = 0;

  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`ok - ${entry.name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${entry.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  return { total: tests.length, failed };
}
