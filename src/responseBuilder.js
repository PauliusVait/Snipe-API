import { logger } from './logger';

export function buildLogSummaryResponse() {
    const logs = logger.getLogs();
    
    // Construct a formatted message
    let formattedMessage = "Processing Summary:\n\n";
    logs.forEach(log => {
        formattedMessage += `- ${log}\n`;
    });
    
    logger.clearLogs();
    
    return buildOutput(formattedMessage); 
}

export const buildOutput = (message) => ({
    body: message,
    headers: {
        'Content-Type': ['text/plain; charset=utf-8']
    },
    statusCode: 200,
    statusText: 'OK'
});
