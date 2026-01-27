package ws

import (
	"encoding/json"
	"testing"
)

func TestMessageSerialization(t *testing.T) {
	tests := []struct {
		name string
		msg  Message
	}{
		{
			name: "subscribe message",
			msg: Message{
				Op: OpSubscribe,
				Args: []SubscribeArg{
					{Channel: ChannelTickers, InstID: "MEME-BNB-PERP"},
				},
			},
		},
		{
			name: "unsubscribe message",
			msg: Message{
				Op: OpUnsubscribe,
				Args: []SubscribeArg{
					{Channel: ChannelTrades, InstID: "MEME-BNB-PERP"},
				},
			},
		},
		{
			name: "ping message",
			msg: Message{
				Op: OpPing,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Marshal
			data, err := json.Marshal(tt.msg)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}

			// Unmarshal
			var parsed Message
			if err := json.Unmarshal(data, &parsed); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			if parsed.Op != tt.msg.Op {
				t.Errorf("Op mismatch: got %s, want %s", parsed.Op, tt.msg.Op)
			}
			if len(parsed.Args) != len(tt.msg.Args) {
				t.Errorf("Args length mismatch: got %d, want %d", len(parsed.Args), len(tt.msg.Args))
			}
		})
	}
}

func TestBuildChannelKey(t *testing.T) {
	tests := []struct {
		name     string
		channel  string
		instID   string
		expected string
	}{
		{"ticker with instId", ChannelTickers, "MEME-BNB-PERP", "tickers:MEME-BNB-PERP"},
		{"candle with instId", ChannelCandles, "MEME-BNB-PERP", "candle:MEME-BNB-PERP"},
		{"trades with instId", ChannelTrades, "MEME-BNB-PERP", "trades:MEME-BNB-PERP"},
		{"channel without instId", ChannelTickers, "", "tickers"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := buildChannelKey(tt.channel, tt.instID)
			if result != tt.expected {
				t.Errorf("buildChannelKey(%s, %s) = %s, want %s", tt.channel, tt.instID, result, tt.expected)
			}
		})
	}
}

func TestPushMessageSerialization(t *testing.T) {
	tests := []struct {
		name string
		msg  PushMessage
	}{
		{
			name: "ticker push",
			msg: PushMessage{
				Arg: SubscribeArg{
					Channel: ChannelTickers,
					InstID:  "MEME-BNB-PERP",
				},
				Data: json.RawMessage(`{"last":"0.0001","vol24h":"1000000"}`),
			},
		},
		{
			name: "trade push",
			msg: PushMessage{
				Arg: SubscribeArg{
					Channel: ChannelTrades,
					InstID:  "MEME-BNB-PERP",
				},
				Data: json.RawMessage(`[{"tradeId":"123","px":"0.0001","sz":"1000","side":"buy"}]`),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.msg)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}

			var parsed PushMessage
			if err := json.Unmarshal(data, &parsed); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			if parsed.Arg.Channel != tt.msg.Arg.Channel {
				t.Errorf("Channel mismatch: got %s, want %s", parsed.Arg.Channel, tt.msg.Arg.Channel)
			}
			if parsed.Arg.InstID != tt.msg.Arg.InstID {
				t.Errorf("InstID mismatch: got %s, want %s", parsed.Arg.InstID, tt.msg.Arg.InstID)
			}
		})
	}
}

func TestSubscribeArgValidation(t *testing.T) {
	validChannels := []string{
		ChannelTickers,
		ChannelCandles,
		ChannelTrades,
		ChannelBooks,
		ChannelMarkPrice,
		ChannelFundingRate,
		ChannelAccount,
		ChannelPositions,
		ChannelOrders,
		ChannelLiquidation,
	}

	for _, channel := range validChannels {
		arg := SubscribeArg{
			Channel: channel,
			InstID:  "MEME-BNB-PERP",
		}

		data, err := json.Marshal(arg)
		if err != nil {
			t.Errorf("Failed to marshal %s: %v", channel, err)
		}

		var parsed SubscribeArg
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Errorf("Failed to unmarshal %s: %v", channel, err)
		}

		if parsed.Channel != channel {
			t.Errorf("Channel mismatch for %s", channel)
		}
	}
}

func BenchmarkMessageSerialization(b *testing.B) {
	msg := Message{
		Op: OpSubscribe,
		Args: []SubscribeArg{
			{Channel: ChannelTickers, InstID: "MEME-BNB-PERP"},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		data, _ := json.Marshal(msg)
		var parsed Message
		json.Unmarshal(data, &parsed)
	}
}

func BenchmarkBuildChannelKey(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		buildChannelKey(ChannelTickers, "MEME-BNB-PERP")
	}
}
