package model

import (
	"database/sql/driver"
	"fmt"
	"math/big"

	"github.com/shopspring/decimal"
)

// Decimal wraps shopspring/decimal for GORM compatibility
type Decimal struct {
	decimal.Decimal
}

func NewDecimal(d decimal.Decimal) Decimal {
	return Decimal{Decimal: d}
}

func NewDecimalFromString(s string) (Decimal, error) {
	d, err := decimal.NewFromString(s)
	if err != nil {
		return Decimal{}, err
	}
	return Decimal{Decimal: d}, nil
}

func NewDecimalFromInt(i int64) Decimal {
	return Decimal{Decimal: decimal.NewFromInt(i)}
}

func NewDecimalFromFloat(f float64) Decimal {
	return Decimal{Decimal: decimal.NewFromFloat(f)}
}

func NewDecimalFromBigInt(b *big.Int) (Decimal, error) {
	if b == nil {
		return Decimal{Decimal: decimal.Zero}, nil
	}
	// Convert big.Int to decimal, assuming 18 decimal places for wei
	d := decimal.NewFromBigInt(b, 0)
	return Decimal{Decimal: d}, nil
}

func (d Decimal) Value() (driver.Value, error) {
	return d.Decimal.String(), nil
}

func (d *Decimal) Scan(value interface{}) error {
	if value == nil {
		d.Decimal = decimal.Zero
		return nil
	}

	switch v := value.(type) {
	case []byte:
		dec, err := decimal.NewFromString(string(v))
		if err != nil {
			return err
		}
		d.Decimal = dec
	case string:
		dec, err := decimal.NewFromString(v)
		if err != nil {
			return err
		}
		d.Decimal = dec
	case float64:
		d.Decimal = decimal.NewFromFloat(v)
	case int64:
		d.Decimal = decimal.NewFromInt(v)
	default:
		return fmt.Errorf("cannot scan type %T into Decimal", value)
	}
	return nil
}

// MarshalJSON implements json.Marshaler
func (d Decimal) MarshalJSON() ([]byte, error) {
	return []byte(`"` + d.Decimal.String() + `"`), nil
}

// UnmarshalJSON implements json.Unmarshaler
func (d *Decimal) UnmarshalJSON(data []byte) error {
	// Remove quotes if present
	s := string(data)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		s = s[1 : len(s)-1]
	}

	dec, err := decimal.NewFromString(s)
	if err != nil {
		return err
	}
	d.Decimal = dec
	return nil
}

// Helper methods
func (d Decimal) Add(d2 Decimal) Decimal {
	return Decimal{Decimal: d.Decimal.Add(d2.Decimal)}
}

func (d Decimal) Sub(d2 Decimal) Decimal {
	return Decimal{Decimal: d.Decimal.Sub(d2.Decimal)}
}

func (d Decimal) Mul(d2 Decimal) Decimal {
	return Decimal{Decimal: d.Decimal.Mul(d2.Decimal)}
}

func (d Decimal) Div(d2 Decimal) Decimal {
	return Decimal{Decimal: d.Decimal.Div(d2.Decimal)}
}

func (d Decimal) Neg() Decimal {
	return Decimal{Decimal: d.Decimal.Neg()}
}

func (d Decimal) Abs() Decimal {
	return Decimal{Decimal: d.Decimal.Abs()}
}

func (d Decimal) IsZero() bool {
	return d.Decimal.IsZero()
}

func (d Decimal) IsPositive() bool {
	return d.Decimal.IsPositive()
}

func (d Decimal) IsNegative() bool {
	return d.Decimal.IsNegative()
}

func (d Decimal) LessThan(d2 Decimal) bool {
	return d.Decimal.LessThan(d2.Decimal)
}

func (d Decimal) LessThanOrEqual(d2 Decimal) bool {
	return d.Decimal.LessThanOrEqual(d2.Decimal)
}

func (d Decimal) GreaterThan(d2 Decimal) bool {
	return d.Decimal.GreaterThan(d2.Decimal)
}

func (d Decimal) GreaterThanOrEqual(d2 Decimal) bool {
	return d.Decimal.GreaterThanOrEqual(d2.Decimal)
}

func (d Decimal) Equal(d2 Decimal) bool {
	return d.Decimal.Equal(d2.Decimal)
}

// Zero returns a zero decimal
func Zero() Decimal {
	return Decimal{Decimal: decimal.Zero}
}
