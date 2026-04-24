export function withoutJsonContentType(headers) {
    const sanitized = {};
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'content-type') {
            continue;
        }
        sanitized[key] = value;
    }
    return sanitized;
}
//# sourceMappingURL=httpHeaders.js.map