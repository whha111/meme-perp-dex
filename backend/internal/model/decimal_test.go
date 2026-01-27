package model

import (
	"encoding/json"
	"testing"
)

func TestDecimalBasicOperations(t *testing.T) {
	tests := []struct {
		name   string
		a      Decimal
		b      Decimal
		addExp Decimal
		subExp Decimal
		mulExp Decimal
	}{
		{
			name:   "positive numbers",
			a:      NewDecimalFromFloat(10.5),
			b:      NewDecimalFromFloat(3.2),
			addExp: NewDecimalFromFloat(13.7),
			subExp: NewDecimalFromFloat(7.3),
			mulExp: NewDecimalFromFloat(33.6),
		},
		{
			name:   "zero operations",
			a:      NewDecimalFromFloat(5.0),
			b:      Zero(),
			addExp: NewDecimalFromFloat(5.0),
			subExp: NewDecimalFromFloat(5.0),
			mulExp: Zero(),
		},
		{
			name:   "negative numbers",
			a:      NewDecimalFromFloat(-5.0),
			b:      NewDecimalFromFloat(3.0),
			addExp: NewDecimalFromFloat(-2.0),
			subExp: NewDecimalFromFloat(-8.0),
			mulExp: NewDecimalFromFloat(-15.0),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !tt.a.Add(tt.b).Equal(tt.addExp) {
				t.Errorf("Add: %v + %v = %v, want %v", tt.a, tt.b, tt.a.Add(tt.b), tt.addExp)
			}
			if !tt.a.Sub(tt.b).Equal(tt.subExp) {
				t.Errorf("Sub: %v - %v = %v, want %v", tt.a, tt.b, tt.a.Sub(tt.b), tt.subExp)
			}
			if !tt.a.Mul(tt.b).Equal(tt.mulExp) {
				t.Errorf("Mul: %v * %v = %v, want %v", tt.a, tt.b, tt.a.Mul(tt.b), tt.mulExp)
			}
		})
	}
}

func TestDecimalComparison(t *testing.T) {
	tests := []struct {
		name        string
		a           Decimal
		b           Decimal
		expectLess  bool
		expectEqual bool
	}{
		{
			name:        "a less than b",
			a:           NewDecimalFromFloat(5.0),
			b:           NewDecimalFromFloat(10.0),
			expectLess:  true,
			expectEqual: false,
		},
		{
			name:        "a equals b",
			a:           NewDecimalFromFloat(5.0),
			b:           NewDecimalFromFloat(5.0),
			expectLess:  false,
			expectEqual: true,
		},
		{
			name:        "a greater than b",
			a:           NewDecimalFromFloat(10.0),
			b:           NewDecimalFromFloat(5.0),
			expectLess:  false,
			expectEqual: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.a.LessThan(tt.b) != tt.expectLess {
				t.Errorf("LessThan: %v < %v = %v, want %v", tt.a, tt.b, tt.a.LessThan(tt.b), tt.expectLess)
			}
			if tt.a.Equal(tt.b) != tt.expectEqual {
				t.Errorf("Equal: %v == %v = %v, want %v", tt.a, tt.b, tt.a.Equal(tt.b), tt.expectEqual)
			}
		})
	}
}

func TestDecimalDivision(t *testing.T) {
	tests := []struct {
		name   string
		a      Decimal
		b      Decimal
		expect Decimal
	}{
		{
			name:   "basic division",
			a:      NewDecimalFromFloat(10.0),
			b:      NewDecimalFromFloat(2.0),
			expect: NewDecimalFromFloat(5.0),
		},
		{
			name:   "fractional result",
			a:      NewDecimalFromFloat(10.0),
			b:      NewDecimalFromFloat(3.0),
			expect: NewDecimalFromFloat(3.3333333333333335), // floating point approximation
		},
		{
			name:   "division by one",
			a:      NewDecimalFromFloat(7.5),
			b:      NewDecimalFromFloat(1.0),
			expect: NewDecimalFromFloat(7.5),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.a.Div(tt.b)
			// Use approximate comparison for floating point
			diff := result.Sub(tt.expect).Abs()
			tolerance := NewDecimalFromFloat(0.0001)
			if diff.GreaterThan(tolerance) {
				t.Errorf("Div: %v / %v = %v, want approximately %v", tt.a, tt.b, result, tt.expect)
			}
		})
	}
}

func TestDecimalJSONSerialization(t *testing.T) {
	type testStruct struct {
		Value Decimal `json:"value"`
	}

	tests := []struct {
		name        string
		value       Decimal
		expectJSON  string
	}{
		{
			name:       "positive number",
			value:      NewDecimalFromFloat(123.456),
			expectJSON: `{"value":"123.456"}`,
		},
		{
			name:       "zero",
			value:      Zero(),
			expectJSON: `{"value":"0"}`,
		},
		{
			name:       "small decimal",
			value:      NewDecimalFromFloat(0.00001),
			expectJSON: `{"value":"0.00001"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := testStruct{Value: tt.value}
			data, err := json.Marshal(s)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}

			// Unmarshal and check
			var parsed testStruct
			if err := json.Unmarshal(data, &parsed); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			if !parsed.Value.Equal(tt.value) {
				t.Errorf("Round-trip failed: got %v, want %v", parsed.Value, tt.value)
			}
		})
	}
}

func TestDecimalFromString(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		expectErr bool
	}{
		{"valid integer", "100", false},
		{"valid decimal", "123.456", false},
		{"valid negative", "-50.5", false},
		{"valid zero", "0", false},
		{"valid scientific", "1e18", false},
		{"invalid string", "abc", true},
		{"empty string", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewDecimalFromString(tt.input)
			if (err != nil) != tt.expectErr {
				t.Errorf("NewDecimalFromString(%q) error = %v, expectErr %v", tt.input, err, tt.expectErr)
			}
		})
	}
}

func TestDecimalAbs(t *testing.T) {
	tests := []struct {
		name   string
		input  Decimal
		expect Decimal
	}{
		{"positive", NewDecimalFromFloat(5.0), NewDecimalFromFloat(5.0)},
		{"negative", NewDecimalFromFloat(-5.0), NewDecimalFromFloat(5.0)},
		{"zero", Zero(), Zero()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.input.Abs()
			if !result.Equal(tt.expect) {
				t.Errorf("Abs(%v) = %v, want %v", tt.input, result, tt.expect)
			}
		})
	}
}

func TestDecimalNeg(t *testing.T) {
	tests := []struct {
		name   string
		input  Decimal
		expect Decimal
	}{
		{"positive", NewDecimalFromFloat(5.0), NewDecimalFromFloat(-5.0)},
		{"negative", NewDecimalFromFloat(-5.0), NewDecimalFromFloat(5.0)},
		{"zero", Zero(), Zero()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.input.Neg()
			if !result.Equal(tt.expect) {
				t.Errorf("Neg(%v) = %v, want %v", tt.input, result, tt.expect)
			}
		})
	}
}

func TestDecimalIsZero(t *testing.T) {
	tests := []struct {
		name   string
		input  Decimal
		expect bool
	}{
		{"zero", Zero(), true},
		{"positive", NewDecimalFromFloat(1.0), false},
		{"negative", NewDecimalFromFloat(-1.0), false},
		{"very small", NewDecimalFromFloat(0.0000001), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.input.IsZero() != tt.expect {
				t.Errorf("IsZero(%v) = %v, want %v", tt.input, tt.input.IsZero(), tt.expect)
			}
		})
	}
}
