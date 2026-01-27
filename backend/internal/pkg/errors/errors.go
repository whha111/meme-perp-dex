package errors

import (
	"fmt"
	"net/http"
)

// Error codes
const (
	// Success
	CodeSuccess = 0

	// System errors (1-999)
	CodeOperationFailed = 1
	CodeSystemBusy      = 2

	// General errors (50000-50099)
	CodeEmptyRequest     = 50000
	CodeSystemError      = 50001
	CodeJSONParseError   = 50002
	CodeRequestTimeout   = 50004
	CodeAPIFrozen        = 50005
	CodeRateLimitExceed  = 50011
	CodeAccountNotFound  = 50012
	CodeAccountFrozen    = 50013
	CodePositionNotFound = 50014

	// Auth errors (50100-50199)
	CodeInvalidAPIKey    = 50100
	CodeAPIKeyExpired    = 50101
	CodeSignatureInvalid = 50102
	CodeTimestampInvalid = 50103
	CodeIPNotWhitelisted = 50104
	CodePermissionDenied = 50105

	// Trading errors (51000-51999)
	CodeInstrumentNotFound  = 51000
	CodeInstrumentSuspended = 51001
	CodeOrderNotFound       = 51002
	CodeOrderFilled         = 51003
	CodeOrderCanceled       = 51004
	CodeOrderQuantityLimit  = 51005
	CodePriceOutOfRange     = 51006
	CodeInsufficientBalance = 51007
	CodePositionNotExist    = 51008
	CodeInsufficientPos     = 51009
	CodeInvalidLeverage     = 51010
	CodeInvalidOrderType    = 51011
	CodeInvalidSide         = 51012
	CodeQuantityTooSmall    = 51020
	CodeQuantityTooLarge    = 51021
	CodeAmountTooSmall      = 51022
	CodeAmountTooLarge      = 51023
	CodeInvalidPricePrecision = 51024
	CodeInvalidSizePrecision  = 51025

	// Account errors (52000-52999)
	CodeAccountTypeError       = 52000
	CodeInsufficientMargin     = 52001
	CodePositionMarginInsuff   = 52002
	CodeExceedMaxPosition      = 52003
	CodeExceedMaxLeverage      = 52004
	CodeCannotAdjustMargin     = 52005
	CodeTransferFailed         = 52006

	// Risk control errors (53000-53999)
	CodeRiskControlTriggered = 53000
	CodePriceDeviationLimit  = 53001
	CodeSingleTradeTooLarge  = 53002
	CodePositionLimitExceed  = 53003
	CodeInLiquidation        = 53004
	CodeLiquidated           = 53005
)

var codeMessages = map[int]string{
	CodeSuccess:         "success",
	CodeOperationFailed: "operation failed",
	CodeSystemBusy:      "system busy",

	CodeEmptyRequest:     "request parameter is empty",
	CodeSystemError:      "system error",
	CodeJSONParseError:   "JSON parse error",
	CodeRequestTimeout:   "request timeout",
	CodeAPIFrozen:        "API access is frozen",
	CodeRateLimitExceed:  "rate limit exceeded",
	CodeAccountNotFound:  "account not found",
	CodeAccountFrozen:    "account is frozen",
	CodePositionNotFound: "position not found",

	CodeInvalidAPIKey:    "invalid API key",
	CodeAPIKeyExpired:    "API key expired",
	CodeSignatureInvalid: "signature verification failed",
	CodeTimestampInvalid: "invalid timestamp",
	CodeIPNotWhitelisted: "IP not in whitelist",
	CodePermissionDenied: "permission denied",

	CodeInstrumentNotFound:    "instrument not found",
	CodeInstrumentSuspended:   "instrument is suspended",
	CodeOrderNotFound:         "order not found",
	CodeOrderFilled:           "order already filled",
	CodeOrderCanceled:         "order already canceled",
	CodeOrderQuantityLimit:    "order quantity exceeds limit",
	CodePriceOutOfRange:       "price out of range",
	CodeInsufficientBalance:   "insufficient balance",
	CodePositionNotExist:      "position does not exist",
	CodeInsufficientPos:       "insufficient position to close",
	CodeInvalidLeverage:       "invalid leverage",
	CodeInvalidOrderType:      "invalid order type",
	CodeInvalidSide:           "invalid side",
	CodeQuantityTooSmall:      "quantity too small",
	CodeQuantityTooLarge:      "quantity too large",
	CodeAmountTooSmall:        "amount too small",
	CodeAmountTooLarge:        "amount too large",
	CodeInvalidPricePrecision: "invalid price precision",
	CodeInvalidSizePrecision:  "invalid size precision",

	CodeAccountTypeError:     "account type error",
	CodeInsufficientMargin:   "insufficient margin",
	CodePositionMarginInsuff: "position margin insufficient",
	CodeExceedMaxPosition:    "exceed maximum position",
	CodeExceedMaxLeverage:    "exceed maximum leverage",
	CodeCannotAdjustMargin:   "cannot adjust margin",
	CodeTransferFailed:       "transfer failed",

	CodeRiskControlTriggered: "risk control triggered",
	CodePriceDeviationLimit:  "price deviation exceeds limit",
	CodeSingleTradeTooLarge:  "single trade too large",
	CodePositionLimitExceed:  "position limit exceeded",
	CodeInLiquidation:        "in liquidation process",
	CodeLiquidated:           "already liquidated",
}

// AppError represents an application error
type AppError struct {
	Code    int    `json:"code"`
	Message string `json:"msg"`
	Err     error  `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%d] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

func (e *AppError) Unwrap() error {
	return e.Err
}

// HTTPStatus returns the HTTP status code for this error
func (e *AppError) HTTPStatus() int {
	switch {
	case e.Code == CodeSuccess:
		return http.StatusOK
	case e.Code >= 50100 && e.Code < 50200:
		return http.StatusUnauthorized
	case e.Code >= 50000 && e.Code < 51000:
		return http.StatusBadRequest
	case e.Code >= 51000 && e.Code < 52000:
		return http.StatusBadRequest
	case e.Code >= 52000 && e.Code < 53000:
		return http.StatusBadRequest
	case e.Code >= 53000 && e.Code < 54000:
		return http.StatusForbidden
	default:
		return http.StatusInternalServerError
	}
}

// New creates a new AppError
func New(code int) *AppError {
	msg, ok := codeMessages[code]
	if !ok {
		msg = "unknown error"
	}
	return &AppError{Code: code, Message: msg}
}

// Newf creates a new AppError with formatted message
func Newf(code int, format string, args ...interface{}) *AppError {
	return &AppError{
		Code:    code,
		Message: fmt.Sprintf(format, args...),
	}
}

// Wrap wraps an error with AppError
func Wrap(code int, err error) *AppError {
	msg, ok := codeMessages[code]
	if !ok {
		msg = "unknown error"
	}
	return &AppError{Code: code, Message: msg, Err: err}
}

// WrapWithMessage wraps an error with custom message
func WrapWithMessage(code int, message string, err error) *AppError {
	return &AppError{Code: code, Message: message, Err: err}
}

// IsAppError checks if err is an AppError
func IsAppError(err error) bool {
	_, ok := err.(*AppError)
	return ok
}

// GetCode gets the error code, returns CodeSystemError if not AppError
func GetCode(err error) int {
	if appErr, ok := err.(*AppError); ok {
		return appErr.Code
	}
	return CodeSystemError
}

// Common errors
var (
	ErrSuccess           = New(CodeSuccess)
	ErrSystemError       = New(CodeSystemError)
	ErrInvalidRequest    = New(CodeEmptyRequest)
	ErrRateLimit         = New(CodeRateLimitExceed)
	ErrUnauthorized      = New(CodeInvalidAPIKey)
	ErrSignatureInvalid  = New(CodeSignatureInvalid)
	ErrInstrumentNotFound = New(CodeInstrumentNotFound)
	ErrOrderNotFound     = New(CodeOrderNotFound)
	ErrPositionNotFound  = New(CodePositionNotFound)
	ErrInsufficientBalance = New(CodeInsufficientBalance)
	ErrInsufficientMargin = New(CodeInsufficientMargin)
)
