const { spawn } = require('child_process');
const fs = require('fs');

console.log('Running end-to-end tests...');
const child = spawn('node', ['test_all_endpoints.js'], { cwd: __dirname });

let out = '';
child.stdout.on('data', d => {
  out += d.toString();
  process.stdout.write(d.toString());
});
child.stderr.on('data', d => {
  out += d.toString();
  process.stderr.write(d.toString());
});

child.on('close', code => {
  const path = require('path');
  fs.writeFileSync(path.join(__dirname, 'test_run_result.txt'), out);
  console.log(`Tests finished with code ${code}`);
  process.exit(code);
});
