package controller

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// TaskCancel 取消（删除）一个尚未结束的任务。
//
// 对外接口：POST /v1/videos/{task_id}/cancel（与 DELETE /v1/videos/{task_id} 等价）。
// 只有实现了 channel.TaskCanceller 的适配器才支持取消；其它渠道返回 cancel_not_supported，
// 不会出现「假装取消成功但任务还在跑」的情况。
//
// 取消成功的处理与「任务失败」一致：置为 FAILURE（fail_reason 标明用户取消）、停止轮询、
// 并把预扣额度全额退还给用户。状态更新用 CAS（UpdateWithStatus）防止与轮询并发重复结算。
func TaskCancel(c *gin.Context) {
	taskID := c.Param("task_id")
	if strings.TrimSpace(taskID) == "" {
		// DELETE /v1/videos/:task_id 路由参数同名，这里兜底
		taskID = c.Param("video_id")
	}
	if strings.TrimSpace(taskID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"message": "task_id is required", "type": "new_api_error", "code": "invalid_request"},
		})
		return
	}

	userId := c.GetInt("id")
	var task *model.Task
	var exist bool
	var err error
	if c.GetInt("role") >= common.RoleAdminUser {
		task, exist, err = model.GetTaskByIdGlobal(taskID)
	} else {
		task, exist, err = model.GetByTaskId(userId, taskID)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": "failed to query task", "type": "new_api_error", "code": "query_task_failed"},
		})
		return
	}
	if !exist || task == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"message": "task not found", "type": "new_api_error", "code": "task_not_exist"},
		})
		return
	}

	if task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("task already finished with status %s", task.Status),
				"type":    "new_api_error",
				"code":    "task_already_finished",
			},
		})
		return
	}

	ch, err := model.CacheGetChannel(task.ChannelId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": "failed to retrieve channel information", "type": "new_api_error", "code": "get_channel_failed"},
		})
		return
	}
	adaptor := relay.GetTaskAdaptor(task.Platform)
	if adaptor == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"message": fmt.Sprintf("invalid platform: %s", task.Platform), "type": "new_api_error", "code": "invalid_platform"},
		})
		return
	}
	canceller, ok := adaptor.(channel.TaskCanceller)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": "this channel does not support canceling tasks, please wait for it to finish",
				"type":    "new_api_error",
				"code":    "cancel_not_supported",
			},
		})
		return
	}

	baseURL := constant.ChannelBaseURLs[ch.Type]
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	// 与轮询保持一致：优先使用提交时记录的 key（多渠道轮换时才是同一个 key），
	// 并把上游模型名带上（部分网关的取消/查询接口需要 ?model=）。
	key := ch.Key
	if task.PrivateData.Key != "" {
		key = task.PrivateData.Key
	}
	modelName := task.Properties.UpstreamModelName
	if modelName == "" {
		modelName = task.Properties.OriginModelName
	}

	resp, err := canceller.CancelTask(baseURL, key, map[string]any{
		"task_id": task.GetUpstreamTaskID(),
		"action":  task.Action,
		"model":   modelName,
	}, ch.GetSetting().Proxy)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("failed to call upstream cancel: %v", err),
				"type":    "new_api_error",
				"code":    "cancel_request_failed",
			},
		})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// 上游拒绝（任务已结束、上游不支持、鉴权失败等）：原文透出，绝不改本地状态。
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("upstream refused to cancel: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(body))),
				"type":    "new_api_error",
				"code":    "cancel_rejected_by_upstream",
			},
		})
		return
	}

	// CAS：只有把状态从「未结束」推进到 FAILURE 成功的那一方才退款，
	// 避免与轮询线程并发时重复退款/重复结算。
	now := time.Now().Unix()
	snap := task.Snapshot()
	task.Status = model.TaskStatusFailure
	task.Progress = taskcommon.ProgressComplete
	task.FailReason = "canceled by user"
	if task.FinishTime == 0 {
		task.FinishTime = now
	}
	won, err := task.UpdateWithStatus(snap.Status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": fmt.Sprintf("failed to update task: %v", err), "type": "new_api_error", "code": "update_task_failed"},
		})
		return
	}
	if !won {
		// 上游已受理取消，但任务已被轮询推进到终态：保持现状，不重复退款。
		c.JSON(http.StatusOK, gin.H{
			"id":      task.TaskID,
			"task_id": task.TaskID,
			"object":  "video",
			"status":  task.Status.ToVideoStatus(),
			"message": "task already reached a terminal state, cancel ignored",
		})
		return
	}

	service.RefundTaskQuota(c.Request.Context(), task, task.FailReason)

	openAIVideo := task.ToOpenAIVideo()
	openAIVideo.SetMetadata("fail_reason", task.FailReason)
	c.JSON(http.StatusOK, openAIVideo)
}
