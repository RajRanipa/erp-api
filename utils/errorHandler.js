// utils/errorHandler.js
import util from 'util';

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

// Centralized error handler function
export function handleError(res, err) {
    if (!err) {
        err = new AppError('Unknown error occurred', { statusCode: 500 });
    }

    let appErr;
    // MongoDB duplicate key error
    if (err.code === 11000) {
        const duplicateField = Object.keys(err.keyValue);
        let msg = '';
        if (Array.isArray(duplicateField) && duplicateField.length > 0) {
            duplicateField.map((field, index) => {
                msg += `${field} - "${err.keyValue[field]}" and `;
            })
            console.log("err Rmsg :- ", msg, err.code)
            // if (!msg.length > 0) return;
            appErr = new AppError(
                `${msg} already exists`,
                { statusCode: 422, code: 'DUPLICATE_ENTRY', details: err.keyValue }
            );
        } else {
            appErr = new AppError(
                `${duplicateField[0]} "${err.keyValue[duplicateField[0]]}" already exists`,
                { statusCode: 422, code: 'DUPLICATE_ENTRY', details: err.keyValue }
            );
        }
    }
    // Mongoose validation error
    else if (err.name === 'ValidationError') {
        const errors = Object.keys(err.errors || {}).map(field => ({
            field,
            message: err.errors[field].message
        }));
        console.log("err Rmsg :- ", errors)
        appErr = new AppError('Validation failed', {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            details: errors
        });
    }
    // JWT errors
    else if (err.name === 'JsonWebTokenError') {
        appErr = new AppError('Invalid token', { statusCode: 401, code: 'INVALID_TOKEN' });
    }
    else if (err.name === 'TokenExpiredError') {
        appErr = new AppError('Token expired', { statusCode: 401, code: 'EXPIRED_TOKEN' });
    }
    // Already a custom AppError
    else if (err instanceof AppError) {
        appErr = err;
    }
    // Fallback for any other error
    else {
        appErr = new AppError(err.message || 'Internal Server Error', {
            statusCode: 500,
            code: 'INTERNAL_ERROR'
        });
    }

    // Log full error for debugging
    console.error('Error caught by handleError:', util.inspect(err, { depth: 4 }));

    // Send response
    return res.status(appErr.statusCode || 500).json({
        status: false,
        status_code: appErr.statusCode || 500,
        message: appErr.message,
        code: appErr.code,
        details: appErr.details || null
    });
}