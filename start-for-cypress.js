// Script to start both frontend and backend for Cypress testing
const { spawn } = require('child_process');

// Start the backend server
const server = spawn('npm', ['run', 'start:server'], {
  stdio: 'inherit',
  shell: true
});

// Start the frontend
const frontend = spawn('npm', ['start'], {
  stdio: 'inherit',
  shell: true
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down test environment...');
  server.kill('SIGINT');
  frontend.kill('SIGINT');
  process.exit(0);
});

console.log('Starting test environment for Cypress...');
console.log('Press Ctrl+C to stop all processes.');

// Log when processes exit
server.on('close', (code) => {
  console.log(`Backend server exited with code ${code}`);
});

frontend.on('close', (code) => {
  console.log(`Frontend server exited with code ${code}`);
});
