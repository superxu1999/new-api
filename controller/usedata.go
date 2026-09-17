package controller

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

func parseFlowQuotaTimeRange(c *gin.Context) (int64, int64, bool) {
	startTimestamp, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || startTimestamp <= 0 {
		common.ApiErrorMsg(c, "invalid start_timestamp")
		return 0, 0, false
	}
	endTimestamp, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || endTimestamp <= 0 {
		common.ApiErrorMsg(c, "invalid end_timestamp")
		return 0, 0, false
	}
	if endTimestamp < startTimestamp {
		common.ApiErrorMsg(c, "invalid time range")
		return 0, 0, false
	}
	return startTimestamp, endTimestamp, true
}

func GetAllQuotaDates(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	dates, err := model.GetAllQuotaDates(startTimestamp, endTimestamp, username)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

func GetQuotaDatesByUser(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	dates, err := model.GetQuotaDataGroupByUser(startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
}

func GetUserQuotaDates(c *gin.Context) {
	userId := c.GetInt("id")
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	// 判断时间跨度是否超过 1 个月
	if endTimestamp-startTimestamp > 2592000 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "时间跨度不能超过 1 个月",
		})
		return
	}
	dates, err := model.GetQuotaDataByUserId(userId, startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

func GetAllFlowQuotaDates(c *gin.Context) {
	startTimestamp, endTimestamp, ok := parseFlowQuotaTimeRange(c)
	if !ok {
		return
	}
	username := c.Query("username")
	dates, err := model.GetFlowQuotaData(startTimestamp, endTimestamp, username, 0, c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

func GetUserFlowQuotaDates(c *gin.Context) {
	userId := c.GetInt("id")
	startTimestamp, endTimestamp, ok := parseFlowQuotaTimeRange(c)
	if !ok {
		return
	}
	if endTimestamp-startTimestamp > 2592000 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "时间跨度不能超过 1 个月",
		})
		return
	}
	dates, err := model.GetFlowQuotaData(startTimestamp, endTimestamp, "", userId, common.RoleCommonUser)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

// quotaDataMoney 把 quota 换算成展示货币金额，跟随当前「额度展示类型」设置。
func quotaDataMoney(quota int) float64 {
	usd := float64(quota) / common.QuotaPerUnit
	return usd * operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
}

// ExportQuotaData 导出「用户 × 模型」维度的消费账单 CSV（管理员，可导出所有用户）。
//
// 输出 UTF-8 BOM，否则 Excel 打开中文表头会乱码。
// 参数错误返回 400：这是文件下载接口，不能用 {success:false} + 200 表达失败，
// 否则前端拿到的是一个内容是错误 JSON 的 .csv 文件。
func ExportQuotaData(c *gin.Context) {
	startTimestamp, endTimestamp, ok := parseBillTimeRange(c)
	if !ok {
		return
	}

	rows, err := model.GetQuotaDataGroupByUserModel(startTimestamp, endTimestamp, 0, c.Query("username"))
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("导出消费账单查询失败 start=%d end=%d error=%q",
			startTimestamp, endTimestamp, err.Error()))
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "导出失败，请稍后重试"})
		return
	}

	writeQuotaBillCSV(c, rows, startTimestamp, endTimestamp)
	logger.LogInfo(c.Request.Context(), fmt.Sprintf("导出消费账单(全部用户) user_id=%d start=%d end=%d username=%q rows=%d",
		c.GetInt("id"), startTimestamp, endTimestamp, c.Query("username"), len(rows)))
}

// ExportSelfQuotaData 用户自助导出自己的消费账单 CSV。
//
// 用户维度强制取登录态，不接受任何查询参数：这是与管理员导出唯一的、也是最关键的差别。
// 管理员那版支持 username 过滤和全量导出，直接复用它就是一个越权读别人账单的洞。
func ExportSelfQuotaData(c *gin.Context) {
	startTimestamp, endTimestamp, ok := parseBillTimeRange(c)
	if !ok {
		return
	}

	userID := c.GetInt("id")
	rows, err := model.GetQuotaDataGroupByUserModel(startTimestamp, endTimestamp, userID, "")
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("导出消费账单查询失败 user_id=%d start=%d end=%d error=%q",
			userID, startTimestamp, endTimestamp, err.Error()))
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "导出失败，请稍后重试"})
		return
	}

	writeQuotaBillCSV(c, rows, startTimestamp, endTimestamp)
	logger.LogInfo(c.Request.Context(), fmt.Sprintf("导出消费账单(本人) user_id=%d start=%d end=%d rows=%d",
		userID, startTimestamp, endTimestamp, len(rows)))
}

// parseBillTimeRange 解析并校验账单导出的时间区间；不合法时已写出 400，调用方直接返回。
func parseBillTimeRange(c *gin.Context) (int64, int64, bool) {
	startTimestamp, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || startTimestamp <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid start_timestamp"})
		return 0, 0, false
	}
	endTimestamp, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || endTimestamp <= 0 || endTimestamp < startTimestamp {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid end_timestamp"})
		return 0, 0, false
	}
	return startTimestamp, endTimestamp, true
}

// writeQuotaBillCSV 把「用户 × 模型」聚合结果写成 CSV 附件返回。
// 管理员导出与用户自助导出共用，保证两边文件格式完全一致。
func writeQuotaBillCSV(c *gin.Context, rows []*model.QuotaData, startTimestamp, endTimestamp int64) {
	moneyHeader := "金额"
	if symbol := operation_setting.GetCurrencySymbol(); symbol != "" {
		moneyHeader = "金额(" + symbol + ")"
	}

	records := make([][]string, 0, len(rows)+1)
	records = append(records, []string{
		"用户ID", "用户名", "模型", "请求数", "Token用量", "额度(quota)", moneyHeader,
	})
	for _, row := range rows {
		records = append(records, []string{
			strconv.Itoa(row.UserID),
			row.Username,
			row.ModelName,
			strconv.Itoa(row.Count),
			strconv.Itoa(row.TokenUsed),
			strconv.Itoa(row.Quota),
			strconv.FormatFloat(quotaDataMoney(row.Quota), 'f', 4, 64),
		})
	}

	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF") // UTF-8 BOM
	writer := csv.NewWriter(&buf)
	if err := writer.WriteAll(records); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("导出消费账单写入 CSV 失败 error=%q", err.Error()))
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "导出失败，请稍后重试"})
		return
	}
	writer.Flush()

	fileName := fmt.Sprintf("usage-bill_%s_%s.csv",
		time.Unix(startTimestamp, 0).Format("20060102"),
		time.Unix(endTimestamp, 0).Format("20060102"))
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}
