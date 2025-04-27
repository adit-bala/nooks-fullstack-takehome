// Configure logging level
// Check for command line arguments like --log=debug
const logArgMatch = process.argv.find(arg => arg.startsWith('--log='))?.match(/--log=(\w+)/);
const logArgValue = logArgMatch ? logArgMatch[1] : null;

// Priority: command line arg > environment variable > default
let rawLogLevel = logArgValue || process.env.LOG_LEVEL || 'info';

// Validate log level
const validLogLevels = ['error', 'warn', 'info', 'debug'];
if (!validLogLevels.includes(rawLogLevel)) {
  console.warn(`Invalid log level: ${rawLogLevel}. Using 'info' instead.`);
  rawLogLevel = 'info';
}

const LOG_LEVEL = rawLogLevel as 'error' | 'warn' | 'info' | 'debug';

// Function to determine if a message at the given level should be logged
function shouldLog(level: 'debug'|'info'|'warn'|'error'): boolean {
  const order = { debug: 0, info: 1, warn: 2, error: 3 };
  return order[level] >= order[LOG_LEVEL as keyof typeof order];
}

// Logger utility with level-based filtering
const logger = {
  info: (message: string, ...args: any[]) => {
    if (shouldLog('info')) {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    if (shouldLog('error')) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
    }
  },
  debug: (message: string, ...args: any[]) => {
    if (shouldLog('debug')) {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
};

export { logger, LOG_LEVEL };
