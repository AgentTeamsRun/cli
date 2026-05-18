export function formatOutput(data, format) {
    if (format === 'json') {
        return JSON.stringify(data, null, 2);
    }
    return formatText(data);
}
function formatText(data) {
    if (Array.isArray(data)) {
        return data.map((item) => formatObject(item)).join('\n\n');
    }
    if (data.data) {
        if (Array.isArray(data.data)) {
            return data.data.map((item) => formatObject(item)).join('\n\n');
        }
        return formatObject(data.data);
    }
    return formatObject(data);
}
function formatObject(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return String(obj);
    }
    const lines = [];
    const preferredOrder = ['id', 'title', 'status', 'type', 'priority', 'updatedAt', 'createdAt'];
    const entries = Object.entries(obj).sort(([a], [b]) => {
        const leftPriority = preferredOrder.indexOf(a);
        const rightPriority = preferredOrder.indexOf(b);
        const leftRank = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
        const rightRank = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
        if (leftRank !== rightRank)
            return leftRank - rightRank;
        return a.localeCompare(b);
    });
    for (const [key, value] of entries) {
        if (value === null || value === undefined) {
            continue;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            lines.push(`${key}:`);
            const nested = formatObject(value);
            lines.push(nested
                .split('\n')
                .map((line) => `  ${line}`)
                .join('\n'));
        }
        else if (Array.isArray(value)) {
            lines.push(`${key}: ${value.join(', ')}`);
        }
        else {
            lines.push(`${key}: ${value}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=formatter.js.map