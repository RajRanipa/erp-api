// utils/errorHandler.js
import { sendError } from './apiResponse.js';

// Custom AppError class
export class AppError extends Error {
    constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details = null, isOperational = true } = {}) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}

export function normalizeError(err) {
    if (!err) {
        err = new AppError('Unknown error occurred', { statusCode: 500 });
    }

    let appErr;
    // MongoDB duplicate key error
    if (err.code === 11000) {
        const keyValue = err.keyValue || {};
        const duplicateDescription = Object.entries(keyValue)
            .map(([field, value]) => `${field} "${value}"`)
            .join(', ');
        appErr = new AppError(
            duplicateDescription
                ? `${duplicateDescription} already exists`
                : 'A record with the same unique values already exists',
            {
                statusCode: 409,
                code: 'DUPLICATE_ENTRY',
                details: keyValue,
            }
        );
    }
    // Mongoose validation error
    else if (err.name === 'ValidationError') {
        const errors = Object.keys(err.errors || {}).map(field => ({
            field,
            message: err.errors[field].message
        }));
        // console.log("err Rmsg :- ", errors)
        appErr = new AppError('Validation failed', {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            details: errors
        });
    }
    else if (err.name === 'CastError') {
        appErr = new AppError(`Invalid ${err.path || 'identifier'}`, {
            statusCode: 400,
            code: 'INVALID_VALUE',
            details: { path: err.path, value: err.value },
        });
    }
    // JWT errors
    else if (err.name === 'JsonWebTokenError') {
        appErr = new AppError('Invalid token', { statusCode: 401, code: 'INVALID_TOKEN' });
    }
    else if (err.name === 'TokenExpiredError') {
        appErr = new AppError('Token expired', { statusCode: 401, code: 'EXPIRED_TOKEN' });
    }
    else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        appErr = new AppError('The request body contains invalid JSON.', {
            statusCode: 400,
            code: 'INVALID_JSON',
        });
    }
    else if (err?.name === 'MulterError') {
        appErr = new AppError(err.message || 'File upload failed.', {
            statusCode: 400,
            code: 'UPLOAD_ERROR',
            details: { field: err.field || null },
        });
    }
    // Already a custom AppError
    else if (err instanceof AppError) {
        appErr = err;
    }
    else if (Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 600) {
        appErr = new AppError(err.message || 'Request failed', {
            statusCode: err.statusCode,
            code: typeof err.code === 'string' ? err.code : 'REQUEST_ERROR',
            details: err.details || null,
        });
    }
    // Fallback for any other error
    else {
        appErr = new AppError(err.message || 'Internal Server Error', {
            statusCode: 500,
            code: 'INTERNAL_ERROR',
            isOperational: false,
        });
    }

    return appErr;
}

const logError = (req, originalError, appError) => {
    const entry = {
        requestId: req?.requestId || null,
        method: req?.method || null,
        path: req?.originalUrl || null,
        statusCode: appError.statusCode,
        code: appError.code,
        message: appError.message,
    };

    if (process.env.NODE_ENV !== 'production' && originalError?.stack) {
        entry.stack = originalError.stack;
    }

    const logger = appError.statusCode >= 500 ? console.error : console.warn;
    logger('[api:error]', entry);
};

// Backward-compatible helper for controllers that still use try/catch.
export function handleError(res, err, req = null) {
    const appErr = normalizeError(err);
    logError(req || res?.req, err, appErr);
    return sendError(res, {
        statusCode: appErr.statusCode || 500,
        message: appErr.isOperational || process.env.NODE_ENV !== 'production'
            ? appErr.message
            : 'Internal server error.',
        code: appErr.code,
        details: appErr.details || null,
    });
}

export function notFoundHandler(req, _res, next) {
    next(new AppError(`Route ${req.method} ${req.originalUrl} was not found.`, {
        statusCode: 404,
        code: 'ROUTE_NOT_FOUND',
    }));
}

export function expressErrorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    return handleError(res, err, req);
}
