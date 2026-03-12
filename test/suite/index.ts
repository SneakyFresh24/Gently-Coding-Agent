import * as path from 'path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000
  });

  const testsRoot = path.resolve(__dirname, '..');

  // Add integration test files
  const testFiles = [
    path.resolve(testsRoot, 'integration/extension.test.js')
  ];

  // Add files to the test suite
  testFiles.forEach(f => mocha.addFile(f));

  return new Promise((c, e) => {
    try {
      // Run the mocha test
      mocha.run((failures: number) => {
        if (failures > 0) {
          e(new Error(`${failures} failed tests.`));
        } else {
          c();
        }
      });
    } catch (err) {
      console.error(err);
      e(err);
    }
  });
}