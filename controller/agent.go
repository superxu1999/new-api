package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 代理（RoleAgent）的数据可见性。
//
// 三条不变量：
//  1. 代理不是管理员。RoleAgent 的取值在普通用户之上、管理员之下，因此全站所有
//     `role >= RoleAdminUser` 的判断对它都不成立，天然拿不到任何管理权限。
//  2. 数据范围永远由调用者自己的 id 推导（inviter_id 指向他的直接下级一层），
//     不接受客户端传入的任意用户 id 当过滤条件 —— 传了也只做「是否属于下级」的校验。
//  3. 只读。这里没有任何写用户、写额度、写配置的入口。

type agentUsersPage struct {
	*common.PageInfo
	Summary model.SubordinateSummary `json:"summary"`
}

// GetAgentUsers 返回当前登录代理的直接下级列表与汇总。
func GetAgentUsers(c *gin.Context) {
	agentId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))

	users, total, err := model.GetSubordinateUsers(agentId, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	summary, err := model.SumSubordinateUsage(agentId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(users)
	common.ApiSuccess(c, agentUsersPage{PageInfo: pageInfo, Summary: summary})
}

// GetAgentLogs 返回下级的使用日志，筛选能力与用户自查日志完全一致。
func GetAgentLogs(c *gin.Context) {
	agentId := c.GetInt("id")

	ids, err := model.GetSubordinateIDs(agentId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 客户端可按某个下级过滤；不在下级集合里就当作查不到，而不是报错泄露「该用户存在」。
	if raw := c.Query("user_id"); raw != "" {
		allowed := make([]int, 0, 1)
		if targetId, convErr := strconv.Atoi(raw); convErr == nil {
			for _, id := range ids {
				if id == targetId {
					allowed = append(allowed, id)
					break
				}
			}
		}
		ids = allowed
	}

	pageInfo := common.GetPageQuery(c)
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	modelName := c.Query("model_name")
	tokenName := c.Query("token_name")
	group := c.Query("group")

	logs, total, err := model.GetLogsByUserIDs(ids, logType, startTimestamp, endTimestamp,
		modelName, tokenName, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), group, "", "")
	if err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

// GetAgentStats 按下级逐个汇总消费额度与请求次数，附合计。
func GetAgentStats(c *gin.Context) {
	agentId := c.GetInt("id")
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)

	ids, err := model.GetSubordinateIDs(agentId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stats, err := model.SumUsedQuotaByUserIDs(ids, startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	briefs, err := model.GetUserBriefsByIds(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]gin.H, 0, len(stats))
	totalQuota := 0
	totalCount := 0
	for _, stat := range stats {
		username := ""
		displayName := ""
		if brief, ok := briefs[stat.UserId]; ok {
			username = brief.Username
			displayName = brief.DisplayName
		}
		items = append(items, gin.H{
			"user_id":      stat.UserId,
			"username":     username,
			"display_name": displayName,
			"quota":        stat.Quota,
			"count":        stat.Count,
		})
		totalQuota += stat.Quota
		totalCount += stat.Count
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":             items,
			"total_quota":       totalQuota,
			"total_count":       totalCount,
			"subordinate_count": len(ids),
		},
	})
}

type assignSubordinatesRequest struct {
	// AgentId 为 0 表示解除归属。
	AgentId int   `json:"agent_id"`
	UserIds []int `json:"user_ids"`
}

// AssignSubordinates 把一批用户挂到指定代理名下（仅管理员）。
//
// 只允许把「普通用户」挂到「代理」名下：代理不能被挂到另一个代理下，否则就成了两层，
// 而查询只做一层，第二层的人会永远看不到却又被记录着归属，属于静默的错误状态。
func AssignSubordinates(c *gin.Context) {
	var req assignSubordinatesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if len(req.UserIds) == 0 {
		common.ApiErrorMsg(c, "请选择要分配的用户")
		return
	}

	if req.AgentId != 0 {
		agent, err := model.GetUserById(req.AgentId, false)
		if err != nil || agent == nil {
			common.ApiErrorMsg(c, "代理不存在")
			return
		}
		if agent.Role != common.RoleAgent {
			common.ApiErrorMsg(c, "目标账号不是代理角色")
			return
		}
	}

	seen := make(map[int]bool, len(req.UserIds))
	cleanIds := make([]int, 0, len(req.UserIds))
	for _, userId := range req.UserIds {
		if seen[userId] {
			continue
		}
		seen[userId] = true
		target, err := model.GetUserById(userId, false)
		if err != nil || target == nil {
			common.ApiErrorMsg(c, "用户不存在")
			return
		}
		if target.Id == req.AgentId {
			common.ApiErrorMsg(c, "不能把代理挂到自己名下")
			return
		}
		if target.Role >= common.RoleAgent {
			common.ApiErrorMsg(c, "只能把普通用户分配给代理")
			return
		}
		cleanIds = append(cleanIds, userId)
	}

	if err := model.SetSubordinateInviter(cleanIds, req.AgentId); err != nil {
		common.ApiError(c, err)
		return
	}
	for _, userId := range cleanIds {
		recordManageAuditFor(c, userId, "user.assign_agent", map[string]interface{}{
			"agent_id": req.AgentId,
		})
	}

	common.ApiSuccess(c, gin.H{"assigned": len(cleanIds), "agent_id": req.AgentId})
}
