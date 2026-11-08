export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function asString(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return undefined;
}
export function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
export function asBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    return undefined;
}
export function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Unknown error';
}
export function redactEmail(email) {
    const at = email.indexOf('@');
    if (at <= 0) {
        return '***';
    }
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const visible = local.slice(0, 1);
    return `${visible}***@${domain}`;
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
export function round(value, digits = 0) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
export function unique(values) {
    return [...new Set(values)];
}
export function safeJsonParse(text) {
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=util.js.map