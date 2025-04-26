// Simple script to start the server using ts-node
const { spawn } = require('child_process');
const path = require('path');

// Path to the server entry point
const serverPath = path.join(__dirname, 'server', 'src', 'index.ts');

// Spawn ts-node process
const tsNode = spawn('npx', ['ts-node', serverPath], {
  stdio: 'inherit',
  shell: true
});

// Handle process exit
tsNode.on('close', (code) => {
  console.log(`ts-node process exited with code ${code}`);
});

// Handle process errors
tsNode.on('error', (err) => {
  console.error('Failed to start ts-node process:', err);
});

console.log('Starting server with ts-node...');
