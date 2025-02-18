const winston = require('winston');
const path = require('path');

// Define log levels and colors
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white'
};

winston.addColors(colors);

// Create base logger format
const baseFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create development format
const developmentFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaString = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
        return `${timestamp} ${level}: ${message}${metaString}`;
    })
);

// Create console transport with higher limit
const consoleTransport = new winston.transports.Console({
    format: process.env.NODE_ENV === 'development' ? developmentFormat : baseFormat
});
consoleTransport.on('error', (error) => {
    console.error('Logger transport error:', error);
});

// Set unlimited listeners for console transport
consoleTransport.setMaxListeners(0);

// Create the logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels,
    format: process.env.NODE_ENV === 'development' ? developmentFormat : baseFormat,
    transports: [consoleTransport]
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
    const logDir = path.join(process.cwd(), 'logs');
    
    const errorTransport = new winston.transports.File({ 
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: baseFormat
    });
    errorTransport.setMaxListeners(0);
    
    const combinedTransport = new winston.transports.File({ 
        filename: path.join(logDir, 'combined.log'),
        format: baseFormat
    });
    combinedTransport.setMaxListeners(0);
    
    logger.add(errorTransport);
    logger.add(combinedTransport);
}

// Create child logger factory with proper event handling
const createChildLogger = (opts) => {
    const childLogger = winston.createLogger({
        level: logger.level,
        levels: logger.levels,
        format: logger.format,
        transports: logger.transports.map(t => Object.create(t))
    });

    // Set unlimited listeners for child logger transports
    childLogger.transports.forEach(t => t.setMaxListeners(0));

    // Ensure all log methods are properly bound
    Object.keys(levels).forEach(level => {
        childLogger[level] = (...args) => {
            const [msg, ...rest] = args;
            return childLogger.log(level, msg, { ...opts, ...(rest[0] || {}) });
        };
    });

    return childLogger;
};

// Add child method to logger
logger.child = createChildLogger;

// Verify logger is working
logger.info('Logger initialized', {
    environment: process.env.NODE_ENV,
    level: logger.level,
    methods: Object.keys(levels)
});

// Export the logger instance
module.exports = logger; 