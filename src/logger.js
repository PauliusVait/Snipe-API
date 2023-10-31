export const levels = {
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

export class logger {
    static logs = [];
    static summary = {
        successfulCheckouts: 0,
        errors: 0
    };

    static log(level, ...messages) {
        const logEntry = `[${level}] ${messages.join(' ')}`;
        if ([levels.INFO, levels.ERROR, levels.WARN].includes(level)) this.logs.push(logEntry);

        if (process.env.NODE_ENV !== 'development' || level === levels.ERROR || level === levels.WARN) {
            switch (level) {
                case levels.ERROR:
                    console.error(logEntry);
                    break;
                case levels.WARN:
                    console.warn(logEntry);
                    break;
                default:
                    console.log(logEntry);
            }
        }
    }

    static info(...messages) {
        this.log(levels.INFO, ...messages);
    }

    static debug(...messages) {
        this.log(levels.DEBUG, ...messages);
    }

    static warn(...messages) {
        this.log(levels.WARN, ...messages);
    }

    static error(...messages) {
        this.log(levels.ERROR, ...messages);
    }

    static getLogs() {
        return this.logs;
    }

    static clearLogs() {
        this.logs = [];
    }

    // Summary methods

    static initializeSummary() {
        this.summary.successfulCheckouts = 0;
        this.summary.errors = 0;
    }

    static incrementSuccessCount() {
        this.summary.successfulCheckouts += 1;
    }

    static incrementErrorCount() {
        this.summary.errors += 1;
    }

    static getSummary() {
        return this.summary;
    }
}
