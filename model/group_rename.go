package model

import (
	"strings"

	"gorm.io/gorm"
)

// RenameGroupReferences 把所有引用旧分组名的地方改成新名字，返回各处的改动条数。
//
// 分组在系统里不是实体，只是一段字符串，散落在用户、令牌、渠道三张表里；
// 渠道分组是逗号分隔的多值字段，所以必须逐个按「精确匹配」拆分替换，
// 不能直接做子串替换（group_ai 会被 group_a 的子串规则误伤）。
//
// 调用方负责修改定价/倍率等配置项；这里只处理数据库里的引用。
func RenameGroupReferences(oldName string, newName string) (map[string]int64, error) {
	counts := map[string]int64{
		"users":     0,
		"tokens":    0,
		"channels":  0,
		"abilities": 0,
	}
	if oldName == "" || newName == "" || oldName == newName {
		return counts, nil
	}

	affectedUserIds := make([]int, 0, 16)
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where(commonGroupCol+" = ?", oldName).
			Pluck("id", &affectedUserIds).Error; err != nil {
			return err
		}

		userResult := tx.Model(&User{}).Where(commonGroupCol+" = ?", oldName).Update(commonGroupCol, newName)
		if userResult.Error != nil {
			return userResult.Error
		}
		counts["users"] = userResult.RowsAffected

		tokenResult := tx.Model(&Token{}).Where(commonGroupCol+" = ?", oldName).Update(commonGroupCol, newName)
		if tokenResult.Error != nil {
			return tokenResult.Error
		}
		counts["tokens"] = tokenResult.RowsAffected

		// 渠道分组是逗号分隔的多值字段：先全部取出来，按精确匹配改写后再逐条保存，
		// 只有真的变了才写库并重建能力，避免无谓的写放大。
		channels := make([]Channel, 0, 64)
		if err := tx.Find(&channels).Error; err != nil {
			return err
		}
		for i := range channels {
			next, changed := replaceGroupInList(channels[i].Group, oldName, newName)
			if !changed {
				continue
			}
			channels[i].Group = next
			if err := tx.Model(&Channel{}).Where("id = ?", channels[i].Id).
				Update("group", next).Error; err != nil {
				return err
			}
			if err := channels[i].UpdateAbilities(tx); err != nil {
				return err
			}
			counts["channels"]++
			counts["abilities"]++
		}
		return nil
	})
	if err != nil {
		return counts, err
	}
	// 用户分组进了缓存（令牌鉴权直接读缓存里的 group），事务提交后再逐条失效，
	// 否则改名后的一段时间里这些账号仍按旧分组计费与选路。
	for _, userId := range affectedUserIds {
		_ = InvalidateUserCache(userId)
	}
	return counts, nil
}

// replaceGroupInList 在逗号分隔的分组列表里精确替换某个分组名。
func replaceGroupInList(list string, oldName string, newName string) (string, bool) {
	if strings.TrimSpace(list) == "" {
		return list, false
	}
	parts := strings.Split(list, ",")
	changed := false
	seen := make(map[string]bool, len(parts))
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		name := strings.TrimSpace(part)
		if name == "" {
			continue
		}
		if name == oldName {
			name = newName
			changed = true
		}
		// 改名后可能与列表里已有的分组重名，去重避免 "a,a"。
		if seen[name] {
			continue
		}
		seen[name] = true
		result = append(result, name)
	}
	if !changed {
		return list, false
	}
	return strings.Join(result, ","), true
}
