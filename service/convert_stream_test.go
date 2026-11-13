package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// feedChunk 把「一个 OpenAI 流式 chunk」送进转换器，并把返回的 Claude 事件累积起来。
func feedChunk(t *testing.T, info *relaycommon.RelayInfo, delta dto.ChatCompletionsStreamResponseChoiceDelta, finishReason string) []*dto.ClaudeResponse {
	t.Helper()
	info.SendResponseCount++
	chunk := &dto.ChatCompletionsStreamResponse{
		Id:    "chatcmpl-test",
		Model: "claude-opus-5-5",
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{Delta: delta},
		},
	}
	if finishReason != "" {
		chunk.Choices[0].FinishReason = common.GetPointer(finishReason)
		chunk.Usage = &dto.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15}
	}
	return StreamResponseOpenAI2Claude(chunk, info)
}

func newClaudeStreamInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		ClaudeConvertInfo: &relaycommon.ClaudeConvertInfo{
			LastMessagesType: relaycommon.LastMessageTypeNone,
		},
	}
}

// collect 合并多批事件的类型，便于断言。
func collect(events []*dto.ClaudeResponse) []*dto.ClaudeResponse {
	return events
}

// 每个 content_block_delta 之前必须已经收到同 index 的 content_block_start，
// 且 start/stop 一一对应。这是 Claude 客户端（Claude Code）的硬性校验。
func assertBlockProtocol(t *testing.T, events []*dto.ClaudeResponse) {
	t.Helper()
	started := map[int]string{}
	stopped := map[int]bool{}
	seenBlock := false
	for _, event := range events {
		if event == nil {
			continue
		}
		index := -1
		if event.Index != nil {
			index = *event.Index
		}
		switch event.Type {
		case "content_block_start":
			require.Falsef(t, started[index] != "", "block %d started twice", index)
			require.NotNil(t, event.ContentBlock)
			started[index] = event.ContentBlock.Type
			seenBlock = true
		case "content_block_delta":
			require.Truef(t, seenBlock, "delta before any block start")
			require.NotEmptyf(t, started[index], "delta for unstarted block %d", index)
			require.Falsef(t, stopped[index], "delta for stopped block %d", index)
			require.NotNil(t, event.Delta)
		case "content_block_stop":
			require.NotEmptyf(t, started[index], "stop for unstarted block %d", index)
			require.Falsef(t, stopped[index], "block %d stopped twice", index)
			stopped[index] = true
		}
	}
	for index := range started {
		assert.Truef(t, stopped[index], "block %d 未收到 content_block_stop", index)
	}
}

func textDelta(text string) dto.ChatCompletionsStreamResponseChoiceDelta {
	return dto.ChatCompletionsStreamResponseChoiceDelta{Content: common.GetPointer(text)}
}

func reasoningDelta(text string) dto.ChatCompletionsStreamResponseChoiceDelta {
	return dto.ChatCompletionsStreamResponseChoiceDelta{ReasoningContent: common.GetPointer(text)}
}

func toolDelta(index int, id, name, args string) dto.ChatCompletionsStreamResponseChoiceDelta {
	return dto.ChatCompletionsStreamResponseChoiceDelta{
		ToolCalls: []dto.ToolCallResponse{
			{
				Index: common.GetPointer(index),
				ID:    id,
				Type:  "function",
				Function: dto.FunctionResponse{
					Name:      name,
					Arguments: args,
				},
			},
		},
	}
}

// 回归：opus-5-5 的工具参数会在中间被文本块打断。
// 修复前会把工具块索引重新分配，导致「只发 delta、没有 content_block_start」。
func TestStreamResponseOpenAI2Claude_ToolArgsInterleavedWithText(t *testing.T) {
	info := newClaudeStreamInfo()
	var events []*dto.ClaudeResponse

	events = append(events, feedChunk(t, info, reasoningDelta("先想想"), "")...)
	events = append(events, feedChunk(t, info, textDelta("我来看一下"), "")...)
	events = append(events, feedChunk(t, info, toolDelta(0, "call_1", "Bash", ""), "")...)
	events = append(events, feedChunk(t, info, textDelta("继续"), "")...)
	events = append(events, feedChunk(t, info, toolDelta(0, "", "", `{"cmd":"ls"}`), "")...)
	events = append(events, feedChunk(t, info, dto.ChatCompletionsStreamResponseChoiceDelta{}, "tool_calls")...)

	assertBlockProtocol(t, events)
	// 工具参数必须仍然落在工具块里（不能因为中途插入文本而丢参数）。
	var inputJSON string
	for _, event := range events {
		if event.Type == "content_block_delta" && event.Delta != nil && event.Delta.PartialJson != nil {
			inputJSON += *event.Delta.PartialJson
		}
	}
	assert.Equal(t, `{"cmd":"ls"}`, inputJSON)
}

// 并行工具调用：两个工具各自拿到 start，且参数不串号。
func TestStreamResponseOpenAI2Claude_ParallelTools(t *testing.T) {
	info := newClaudeStreamInfo()
	var events []*dto.ClaudeResponse

	events = append(events, feedChunk(t, info, textDelta("查一下"), "")...)

	parallel := dto.ChatCompletionsStreamResponseChoiceDelta{
		ToolCalls: []dto.ToolCallResponse{
			{Index: common.GetPointer(0), ID: "call_a", Type: "function", Function: dto.FunctionResponse{Name: "Read", Arguments: ""}},
			{Index: common.GetPointer(1), ID: "call_b", Type: "function", Function: dto.FunctionResponse{Name: "Bash", Arguments: ""}},
		},
	}
	events = append(events, feedChunk(t, info, parallel, "")...)
	events = append(events, feedChunk(t, info, toolDelta(0, "", "", `{"path":"a"}`), "")...)
	events = append(events, feedChunk(t, info, toolDelta(1, "", "", `{"cmd":"ls"}`), "")...)
	events = append(events, feedChunk(t, info, dto.ChatCompletionsStreamResponseChoiceDelta{}, "tool_calls")...)

	assertBlockProtocol(t, events)

	argsByBlock := map[int]string{}
	for _, event := range events {
		if event.Type != "content_block_delta" || event.Delta == nil || event.Delta.PartialJson == nil {
			continue
		}
		argsByBlock[*event.Index] += *event.Delta.PartialJson
	}
	require.Len(t, argsByBlock, 2)
	values := make([]string, 0, 2)
	for _, value := range argsByBlock {
		values = append(values, value)
	}
	assert.ElementsMatch(t, []string{`{"path":"a"}`, `{"cmd":"ls"}`}, values)
}

// 纯文本流：保持原行为（一个块 + 一个 stop）。
func TestStreamResponseOpenAI2Claude_TextOnly(t *testing.T) {
	info := newClaudeStreamInfo()
	var events []*dto.ClaudeResponse

	events = append(events, feedChunk(t, info, textDelta("你"), "")...)
	events = append(events, feedChunk(t, info, textDelta("好"), "")...)
	events = append(events, feedChunk(t, info, dto.ChatCompletionsStreamResponseChoiceDelta{}, "stop")...)

	assertBlockProtocol(t, events)

	var text string
	for _, event := range events {
		if event.Type == "content_block_delta" && event.Delta != nil && event.Delta.Text != nil {
			text += *event.Delta.Text
		}
	}
	assert.Equal(t, "你好", text)
}

// thinking → text：两个顺序块，各自 start/stop 一次。
func TestStreamResponseOpenAI2Claude_ThinkingThenText(t *testing.T) {
	info := newClaudeStreamInfo()
	var events []*dto.ClaudeResponse

	events = append(events, feedChunk(t, info, reasoningDelta("思考中"), "")...)
	events = append(events, feedChunk(t, info, reasoningDelta("继续"), "")...)
	events = append(events, feedChunk(t, info, textDelta("答案"), "")...)
	events = append(events, feedChunk(t, info, dto.ChatCompletionsStreamResponseChoiceDelta{}, "stop")...)

	assertBlockProtocol(t, events)
}
