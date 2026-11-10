package controller

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

type renameGroupRequest struct {
	OldName string `json:"old_name"`
	NewName string `json:"new_name"`
}

// RenameGroup 给分组改名，并同步所有引用。
//
// 分组在系统里不是实体，只是一段字符串，散落在六处独立配置与三张表里：
// 定价倍率、充值倍率、用户可选分组、特殊可用分组规则、users.group、tokens.group、
// channels.group（还有由它派生的 abilities.group）。
//
// 只改「定价分组」那一处会留下静默错位：已有用户仍在旧分组名下，而旧分组已经从
// 倍率表里消失（计费按 1 兜底），新分组又没有渠道为其服务（abilities 里没有记录）。
// 所以改名必须一次改全。
func RenameGroup(c *gin.Context) {
	var req renameGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	oldName := strings.TrimSpace(req.OldName)
	newName := strings.TrimSpace(req.NewName)
	if oldName == "" || newName == "" {
		common.ApiErrorMsg(c, "分组名称不能为空")
		return
	}
	if oldName == newName {
		common.ApiErrorMsg(c, "新旧分组名称相同")
		return
	}
	if !ratio_setting.ContainsGroupRatio(oldName) {
		// 带上机器可读的 code：前端在「保存时顺带改名」的场景里，需要区分
		// 「这个分组本来就不存在（新建行尚未来得及保存）」和真正的失败，
		// 前者应当跳过改名继续保存，后者应当中断。
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "分组不存在",
			"code":    "group_not_found",
		})
		return
	}
	if ratio_setting.ContainsGroupRatio(newName) {
		common.ApiErrorMsg(c, "目标分组名称已存在，请换一个")
		return
	}

	// 1. 定价倍率
	groupRatioJSON, _, err := renameTopLevelKey(ratio_setting.GroupRatio2JSONString(), oldName, newName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 2. 分组×分组 特殊倍率矩阵：行是用户分组，列是计费分组，两处都要改
	groupGroupRatioJSON, _, err := renameNestedKeys(ratio_setting.GroupGroupRatio2JSONString(), oldName, newName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 3. 用户可选分组
	usableGroupsJSON, _, err := renameTopLevelKey(setting.UserUsableGroups2JSONString(), oldName, newName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 4. 特殊可用分组规则：外层是用户分组，内层是「可用分组」条目，可能带 +: / -: 前缀
	specialJSON, err := renameSpecialUsableGroups(
		ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.ReadAll(), oldName, newName)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 配置先落库并生效，再改数据库引用：两步都成功才算改名完成。
	options := map[string]string{
		"GroupRatio":       groupRatioJSON,
		"GroupGroupRatio":  groupGroupRatioJSON,
		"UserUsableGroups": usableGroupsJSON,
		"group_ratio_setting.group_special_usable_group": specialJSON,
	}
	if err := model.UpdateOptionsBulk(options); err != nil {
		common.ApiError(c, err)
		return
	}

	// 5~7. 用户、令牌、渠道（含重建 abilities）
	counts, err := model.RenameGroupReferences(oldName, newName)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 定价数据有短时缓存，改名后必须立刻失效，否则模型广场仍显示旧分组。
	ratio_setting.InvalidateExposedDataCache()
	recordManageAuditFor(c, 0, "group.rename", map[string]interface{}{
		"old_name": oldName,
		"new_name": newName,
		"users":    counts["users"],
		"tokens":   counts["tokens"],
		"channels": counts["channels"],
	})

	common.ApiSuccess(c, gin.H{
		"old_name":  oldName,
		"new_name":  newName,
		"users":     counts["users"],
		"tokens":    counts["tokens"],
		"channels":  counts["channels"],
		"abilities": counts["abilities"],
	})
}

// renameTopLevelKey 把 JSON 对象的顶层键 oldName 换成 newName，值原样保留。
func renameTopLevelKey(jsonStr string, oldName string, newName string) (string, bool, error) {
	raw := map[string]json.RawMessage{}
	if err := common.Unmarshal([]byte(jsonStr), &raw); err != nil {
		return jsonStr, false, err
	}
	value, ok := raw[oldName]
	if !ok {
		return jsonStr, false, nil
	}
	delete(raw, oldName)
	raw[newName] = value
	out, err := common.Marshal(raw)
	return string(out), true, err
}

// renameNestedKeys 把「键 → 键 → 值」两层结构里出现 oldName 的地方全部改名：
// 外层键（例如用户分组）与内层键（例如计费分组）都改。
func renameNestedKeys(jsonStr string, oldName string, newName string) (string, bool, error) {
	raw := map[string]map[string]json.RawMessage{}
	if err := common.Unmarshal([]byte(jsonStr), &raw); err != nil {
		return jsonStr, false, err
	}
	changed := false
	result := make(map[string]map[string]json.RawMessage, len(raw))
	for outerKey, inner := range raw {
		nextOuter := outerKey
		if outerKey == oldName {
			nextOuter = newName
			changed = true
		}
		nextInner := make(map[string]json.RawMessage, len(inner))
		for innerKey, value := range inner {
			nextInnerKey := innerKey
			if innerKey == oldName {
				nextInnerKey = newName
				changed = true
			}
			nextInner[nextInnerKey] = value
		}
		result[nextOuter] = nextInner
	}
	if !changed {
		return jsonStr, false, nil
	}
	out, err := common.Marshal(result)
	return string(out), true, err
}

// renameSpecialUsableGroups 处理「用户分组 → 可用的分组列表」这张规则表。
// 内层条目可能是普通分组名，也可能带 +:（额外可见）或 -:（屏蔽）前缀，
// 改名时要保住前缀，只替换后面的分组名。
func renameSpecialUsableGroups(special map[string]map[string]string, oldName string, newName string) (string, error) {
	result := make(map[string]map[string]string, len(special))
	for userGroup, entries := range special {
		nextUserGroup := userGroup
		if userGroup == oldName {
			nextUserGroup = newName
		}
		nextEntries := make(map[string]string, len(entries))
		for entry, desc := range entries {
			nextEntry := entry
			for _, prefix := range []string{"+:", "-:"} {
				if strings.HasPrefix(entry, prefix) && strings.TrimPrefix(entry, prefix) == oldName {
					nextEntry = prefix + newName
				}
			}
			if entry == oldName {
				nextEntry = newName
			}
			nextEntries[nextEntry] = desc
		}
		result[nextUserGroup] = nextEntries
	}
	out, err := common.Marshal(result)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
