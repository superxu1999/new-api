package controller

import (
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// 微信支付直连（Native 扫码）。签名与回调解密在 service/wechat_pay.go。
//
// 与其它网关的差异：Native 不跳转收银台，而是把 code_url 交给前端渲染二维码，
// 前端轮询 /api/user/topup/self 判断是否到账。

// 单笔充值金额上限（美元余额单位），与 Stripe 保持一致，避免异常大的金额进入签名链路。
const maxWechatTopUpAmount = 10000

// 退款金额比较容差，覆盖 float64 的元/分换算误差。
const wechatMoneyEpsilon = 0.000001

type WechatPayRequest struct {
	Amount        int64  `json:"amount"`
	PaymentMethod string `json:"payment_method"`
}

type WechatRefundRequest struct {
	TradeNo string  `json:"trade_no"`
	Money   float64 `json:"money"`
	Reason  string  `json:"reason"`
}

type WechatRefundSyncRequest struct {
	RefundNo string `json:"refund_no"`
}

// wechatNotifyUrl 返回微信侧回调地址。微信要求 HTTPS、公网可达且不能携带参数。
func wechatNotifyUrl() (string, error) {
	base := strings.TrimRight(service.GetCallbackAddress(), "/")
	if base == "" {
		return "", errors.New("未配置站点地址或回调地址，无法生成微信支付回调地址")
	}
	if !strings.HasPrefix(strings.ToLower(base), "https://") {
		return "", fmt.Errorf("微信支付要求回调地址使用 HTTPS，当前为 %s", base)
	}
	return base + "/api/wechat/webhook", nil
}

func getWechatMinTopup() int64 {
	minTopUp := setting.WechatMinTopUp
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		minTopUp = minTopUp * int(common.QuotaPerUnit)
	}
	return int64(minTopUp)
}

// getWechatPayMoney 计算应付金额。
//
// 单价直接复用「常规」的 Price，与易支付保持一致：两者都是人民币计费，
// 各自维护一份单价只会让充值页展示的金额和实际扣款悄悄分叉。
func getWechatPayMoney(amount int64, group string) float64 {
	dAmount := decimal.NewFromInt(amount)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount = dAmount.Div(decimal.NewFromFloat(common.QuotaPerUnit))
	}

	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}

	discount := 1.0
	if ds, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(amount)]; ok && ds > 0 {
		discount = ds
	}

	return dAmount.
		Mul(decimal.NewFromFloat(operation_setting.Price)).
		Mul(decimal.NewFromFloat(topupGroupRatio)).
		Mul(decimal.NewFromFloat(discount)).
		InexactFloat64()
}

// validateWechatTopUpAmount 校验金额区间，返回给用户看的错误文案（空串表示通过）。
func validateWechatTopUpAmount(amount int64) string {
	if amount < getWechatMinTopup() {
		return fmt.Sprintf("充值数量不能小于 %d", getWechatMinTopup())
	}
	if amount > maxWechatTopUpAmount {
		return fmt.Sprintf("充值数量不能大于 %d", maxWechatTopUpAmount)
	}
	return ""
}

func RequestWechatAmount(c *gin.Context) {
	var req WechatPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	if message := validateWechatTopUpAmount(req.Amount); message != "" {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": message})
		return
	}

	group, err := model.GetUserGroup(c.GetInt("id"), true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}

	payMoney := getWechatPayMoney(req.Amount, group)
	if payMoney <= 0.01 {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值金额过低"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "success", "data": fmt.Sprintf("%.2f", payMoney)})
}

func RequestWechatPay(c *gin.Context) {
	var req WechatPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	if req.PaymentMethod != model.PaymentMethodWechat {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "不支持的支付渠道"})
		return
	}
	if message := validateWechatTopUpAmount(req.Amount); message != "" {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": message})
		return
	}

	client, err := service.NewWechatPayClient()
	if err != nil {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("微信支付 未就绪 error=%q", err.Error()))
		// 回显具体原因（缺少哪个字段、密钥长度等），否则管理员只看到"未配置"无法定位。
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "微信支付配置有误：" + err.Error()})
		return
	}

	notifyUrl, err := wechatNotifyUrl()
	if err != nil {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("微信支付 回调地址不可用 error=%q", err.Error()))
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
		return
	}

	userId := c.GetInt("id")
	group, err := model.GetUserGroup(userId, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}

	payMoney := getWechatPayMoney(req.Amount, group)
	if payMoney <= 0.01 {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值金额过低"})
		return
	}
	totalFen, err := service.WechatMoneyToFen(payMoney)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值金额非法"})
		return
	}

	tradeNo := fmt.Sprintf("WX%dN%s%d", userId, common.GetRandomString(6), time.Now().Unix())
	topUp := &model.TopUp{
		UserId:          userId,
		Amount:          req.Amount,
		Money:           payMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodWechat,
		PaymentProvider: model.PaymentProviderWechat,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("微信支付 创建充值订单失败 user_id=%d trade_no=%s amount=%d error=%q", userId, tradeNo, req.Amount, err.Error()))
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	codeUrl, err := client.NativeOrder(c.Request.Context(), tradeNo, fmt.Sprintf("充值 %d", req.Amount), totalFen, notifyUrl)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("微信支付 Native下单失败 user_id=%d trade_no=%s amount=%d error=%q", userId, tradeNo, req.Amount, err.Error()))
		if statusErr := model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderWechat, common.TopUpStatusFailed); statusErr != nil {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("微信支付 标记订单失败状态失败 trade_no=%s error=%q", tradeNo, statusErr.Error()))
		}
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "拉起支付失败"})
		return
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("微信支付 Native下单成功 user_id=%d trade_no=%s amount=%d money=%.2f", userId, tradeNo, req.Amount, payMoney))
	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data": gin.H{
			"code_url": codeUrl,
			"trade_no": tradeNo,
			"money":    fmt.Sprintf("%.2f", payMoney),
		},
	})
}

// WechatWebhook 同时处理支付结果与退款结果通知。
// 微信要求成功时返回 200 + {"code":"SUCCESS"}，否则会按策略重推。
func WechatWebhook(c *gin.Context) {
	ctx := c.Request.Context()
	if !isWechatWebhookEnabled() {
		logger.LogWarn(ctx, fmt.Sprintf("微信支付 webhook 被拒绝 reason=webhook_disabled path=%q client_ip=%s", c.Request.RequestURI, c.ClientIP()))
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付 webhook 读取请求体失败 path=%q client_ip=%s error=%q", c.Request.RequestURI, c.ClientIP(), err.Error()))
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}

	client, err := service.NewWechatPayClient()
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付 webhook 客户端不可用 error=%q", err.Error()))
		writeWechatWebhookFail(c, "网关未就绪")
		return
	}

	eventType, plaintext, err := client.DecryptNotification(c.Request.Header, body)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("微信支付 webhook 验签或解密失败 path=%q client_ip=%s error=%q body=%q", c.Request.RequestURI, c.ClientIP(), err.Error(), string(body)))
		writeWechatWebhookFail(c, "验签或解密失败")
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("微信支付 webhook 验签成功 event_type=%s client_ip=%s payload=%q", eventType, c.ClientIP(), string(plaintext)))

	switch eventType {
	case service.WechatEventTransactionSuccess:
		handleWechatTransactionSuccess(c, plaintext)
	case service.WechatEventRefundSuccess, service.WechatEventRefundAbnormal, service.WechatEventRefundClosed:
		handleWechatRefundNotification(c, eventType, plaintext)
	default:
		logger.LogInfo(ctx, fmt.Sprintf("微信支付 webhook 忽略事件 event_type=%s client_ip=%s", eventType, c.ClientIP()))
		writeWechatWebhookSuccess(c)
	}
}

func handleWechatTransactionSuccess(c *gin.Context, plaintext []byte) {
	ctx := c.Request.Context()

	var transaction service.WechatPayTransaction
	if err := common.Unmarshal(plaintext, &transaction); err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付回调解析失败 client_ip=%s error=%q payload=%q", c.ClientIP(), err.Error(), string(plaintext)))
		writeWechatWebhookFail(c, "报文解析失败")
		return
	}
	if transaction.TradeState != service.WechatTradeStateSuccess {
		logger.LogInfo(ctx, fmt.Sprintf("微信支付回调交易状态非成功，忽略 trade_no=%s trade_state=%s", transaction.OutTradeNo, transaction.TradeState))
		writeWechatWebhookSuccess(c)
		return
	}

	topUp := model.GetTopUpByTradeNo(transaction.OutTradeNo)
	if topUp == nil {
		logger.LogWarn(ctx, fmt.Sprintf("微信支付回调订单不存在 trade_no=%s transaction_id=%s", transaction.OutTradeNo, transaction.TransactionId))
		writeWechatWebhookFail(c, "订单不存在")
		return
	}
	if topUp.PaymentProvider != model.PaymentProviderWechat {
		logger.LogWarn(ctx, fmt.Sprintf("微信支付回调网关不匹配 trade_no=%s provider=%s", transaction.OutTradeNo, topUp.PaymentProvider))
		writeWechatWebhookFail(c, "订单网关不匹配")
		return
	}

	// 校验微信侧的实付金额与本地订单一致，避免金额被篡改。
	expectedFen, err := service.WechatMoneyToFen(topUp.Money)
	if err != nil || expectedFen != transaction.Amount.Total {
		logger.LogWarn(ctx, fmt.Sprintf("微信支付回调金额不一致 trade_no=%s expected_fen=%d actual_fen=%d", transaction.OutTradeNo, expectedFen, transaction.Amount.Total))
		writeWechatWebhookFail(c, "订单金额不一致")
		return
	}

	LockOrder(transaction.OutTradeNo)
	defer UnlockOrder(transaction.OutTradeNo)

	if err := model.RechargeWechat(transaction.OutTradeNo, transaction.TransactionId, c.ClientIP()); err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付充值处理失败 trade_no=%s transaction_id=%s client_ip=%s error=%q", transaction.OutTradeNo, transaction.TransactionId, c.ClientIP(), err.Error()))
		writeWechatWebhookFail(c, "入账失败")
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("微信支付充值成功 trade_no=%s transaction_id=%s amount_fen=%d client_ip=%s", transaction.OutTradeNo, transaction.TransactionId, transaction.Amount.Total, c.ClientIP()))
	writeWechatWebhookSuccess(c)
}

func handleWechatRefundNotification(c *gin.Context, eventType string, plaintext []byte) {
	ctx := c.Request.Context()

	var notification struct {
		OutRefundNo  string `json:"out_refund_no"`
		OutTradeNo   string `json:"out_trade_no"`
		RefundId     string `json:"refund_id"`
		RefundStatus string `json:"refund_status"`
		Status       string `json:"status"`
	}
	if err := common.Unmarshal(plaintext, &notification); err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信退款回调解析失败 client_ip=%s error=%q payload=%q", c.ClientIP(), err.Error(), string(plaintext)))
		writeWechatWebhookFail(c, "报文解析失败")
		return
	}
	if notification.OutRefundNo == "" {
		logger.LogWarn(ctx, fmt.Sprintf("微信退款回调缺少退款单号 event_type=%s payload=%q", eventType, string(plaintext)))
		writeWechatWebhookFail(c, "缺少退款单号")
		return
	}

	status := notification.RefundStatus
	if status == "" {
		status = notification.Status
	}

	LockOrder(notification.OutRefundNo)
	defer UnlockOrder(notification.OutRefundNo)

	// 只有 SUCCESS 才算退款到账；ABNORMAL / CLOSED 落到失败终态供人工跟进。
	success := eventType == service.WechatEventRefundSuccess && status == service.WechatRefundStatusSuccess
	failReason := ""
	if !success {
		failReason = fmt.Sprintf("event_type=%s status=%s", eventType, status)
	}

	if err := model.SettleTopUpRefund(notification.OutRefundNo, success, failReason, c.ClientIP()); err != nil {
		if errors.Is(err, model.ErrTopUpRefundNotFound) {
			logger.LogWarn(ctx, fmt.Sprintf("微信退款回调退款单不存在 refund_no=%s", notification.OutRefundNo))
			writeWechatWebhookSuccess(c)
			return
		}
		logger.LogError(ctx, fmt.Sprintf("微信退款回调处理失败 refund_no=%s error=%q", notification.OutRefundNo, err.Error()))
		writeWechatWebhookFail(c, "退款处理失败")
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("微信退款回调处理完成 refund_no=%s out_trade_no=%s success=%t status=%s client_ip=%s", notification.OutRefundNo, notification.OutTradeNo, success, status, c.ClientIP()))
	writeWechatWebhookSuccess(c)
}

func writeWechatWebhookSuccess(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "成功"})
}

func writeWechatWebhookFail(c *gin.Context, message string) {
	c.JSON(http.StatusInternalServerError, gin.H{"code": "FAIL", "message": message})
}

// AdminRequestWechatRefund 管理员发起退款。金额留空或为 0 时退剩余全部。
func AdminRequestWechatRefund(c *gin.Context) {
	ctx := c.Request.Context()

	var req WechatRefundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.TradeNo) == "" {
		common.ApiErrorMsg(c, "缺少订单号")
		return
	}

	client, err := service.NewWechatPayClient()
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("微信支付退款 网关未就绪 error=%q", err.Error()))
		common.ApiErrorMsg(c, "微信支付配置有误："+err.Error())
		return
	}

	topUp := model.GetTopUpByTradeNo(req.TradeNo)
	if topUp == nil {
		common.ApiErrorMsg(c, "充值订单不存在")
		return
	}
	if topUp.PaymentProvider != model.PaymentProviderWechat {
		common.ApiErrorMsg(c, "该订单不是微信支付订单，无法在此退款")
		return
	}
	if topUp.Status != common.TopUpStatusSuccess {
		common.ApiErrorMsg(c, "只有已支付成功的订单才能退款")
		return
	}

	notifyUrl, err := wechatNotifyUrl()
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	// 同一订单的并发退款串行化：剩余可退金额与在途状态都基于读取时的快照。
	LockOrder(topUp.TradeNo)
	defer UnlockOrder(topUp.TradeNo)

	remaining := topUp.Money - topUp.RefundedMoney
	if remaining <= wechatMoneyEpsilon {
		common.ApiErrorMsg(c, "该订单已全额退款")
		return
	}

	refundMoney := req.Money
	if refundMoney <= 0 {
		refundMoney = remaining
	}
	if refundMoney > remaining+wechatMoneyEpsilon {
		common.ApiErrorMsg(c, fmt.Sprintf("退款金额不能大于剩余可退金额 %.2f", remaining))
		return
	}
	refundMoney = math.Round(refundMoney*100) / 100

	// 同一订单同时只允许一笔在途退款，避免并发超额。
	existing, err := model.GetTopUpRefundsByTradeNo(req.TradeNo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	refundedQuota := 0
	for _, item := range existing {
		switch item.Status {
		case model.TopUpRefundStatusPending:
			common.ApiErrorMsg(c, "该订单有退款正在处理中，请稍后再试")
			return
		case model.TopUpRefundStatusSuccess:
			refundedQuota += item.Quota
		}
	}

	grantedQuota := common.QuotaFromFloat(decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).InexactFloat64())
	if grantedQuota <= 0 || topUp.Money <= 0 {
		common.ApiErrorMsg(c, "订单额度异常，无法退款")
		return
	}
	// 用累计比例计算本次应扣额度，避免多次部分退款的舍入漂移。
	cumulativeQuota := common.QuotaFromFloat(decimal.NewFromFloat((topUp.RefundedMoney + refundMoney) / topUp.Money).
		Mul(decimal.NewFromInt(int64(grantedQuota))).InexactFloat64())
	quotaToTake := cumulativeQuota - refundedQuota
	if quotaToTake < 0 {
		quotaToTake = 0
	}

	refundFen, err := service.WechatMoneyToFen(refundMoney)
	if err != nil {
		common.ApiErrorMsg(c, "退款金额非法")
		return
	}
	totalFen, err := service.WechatMoneyToFen(topUp.Money)
	if err != nil {
		common.ApiErrorMsg(c, "订单金额异常")
		return
	}

	refundNo := fmt.Sprintf("WXR%dN%s%d", topUp.UserId, common.GetRandomString(6), time.Now().Unix())
	refund := &model.TopUpRefund{
		UserId:     topUp.UserId,
		TopUpId:    topUp.Id,
		TradeNo:    topUp.TradeNo,
		RefundNo:   refundNo,
		Money:      refundMoney,
		Quota:      quotaToTake,
		Status:     model.TopUpRefundStatusPending,
		Reason:     strings.TrimSpace(req.Reason),
		OperatorId: c.GetInt("id"),
		CreateTime: time.Now().Unix(),
	}
	if err := refund.Insert(); err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付退款 创建退款单失败 trade_no=%s refund_no=%s error=%q", topUp.TradeNo, refundNo, err.Error()))
		common.ApiErrorMsg(c, "创建退款单失败")
		return
	}

	result, err := client.Refund(ctx, refundNo, topUp.TradeNo, refund.Reason, refundFen, totalFen, notifyUrl)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付退款 请求失败 trade_no=%s refund_no=%s error=%q", topUp.TradeNo, refundNo, err.Error()))
		if settleErr := model.SettleTopUpRefund(refundNo, false, err.Error(), c.ClientIP()); settleErr != nil {
			logger.LogError(ctx, fmt.Sprintf("微信支付退款 标记失败状态失败 refund_no=%s error=%q", refundNo, settleErr.Error()))
		}
		common.ApiErrorMsg(c, "发起退款失败："+err.Error())
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("微信支付退款 已提交 trade_no=%s refund_no=%s refund_money=%.2f status=%s", topUp.TradeNo, refundNo, refundMoney, result.Status))

	switch result.Status {
	case service.WechatRefundStatusSuccess:
		if err := model.SettleTopUpRefund(refundNo, true, "", c.ClientIP()); err != nil {
			logger.LogError(ctx, fmt.Sprintf("微信支付退款 立即结算失败 refund_no=%s error=%q", refundNo, err.Error()))
			common.ApiErrorMsg(c, "退款已受理但结算失败，请稍后在退款记录中确认")
			return
		}
	case service.WechatRefundStatusProcessing:
		// 等待退款结果通知；回调未达时可调用同步接口补偿。
	case service.WechatRefundStatusClosed, service.WechatRefundStatusAbnormal:
		if err := model.SettleTopUpRefund(refundNo, false, result.Status, c.ClientIP()); err != nil {
			logger.LogError(ctx, fmt.Sprintf("微信支付退款 标记失败状态失败 refund_no=%s error=%q", refundNo, err.Error()))
		}
		common.ApiErrorMsg(c, fmt.Sprintf("微信支付退款未成功：%s", result.Status))
		return
	default:
		logger.LogWarn(ctx, fmt.Sprintf("微信支付退款 未知状态 refund_no=%s status=%s", refundNo, result.Status))
	}

	common.ApiSuccess(c, model.GetTopUpRefundByRefundNo(refundNo))
}

// AdminSyncWechatRefund 主动查询退款结果，用于回调丢失时的补偿。
func AdminSyncWechatRefund(c *gin.Context) {
	ctx := c.Request.Context()

	var req WechatRefundSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.RefundNo) == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	refund := model.GetTopUpRefundByRefundNo(req.RefundNo)
	if refund == nil {
		common.ApiErrorMsg(c, "退款单不存在")
		return
	}

	client, err := service.NewWechatPayClient()
	if err != nil {
		common.ApiErrorMsg(c, "微信支付未配置")
		return
	}

	result, err := client.QueryRefund(ctx, refund.RefundNo)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付退款查询失败 refund_no=%s error=%q", refund.RefundNo, err.Error()))
		common.ApiErrorMsg(c, "查询退款失败："+err.Error())
		return
	}

	success := result.Status == service.WechatRefundStatusSuccess
	failReason := ""
	if !success {
		failReason = "查询状态=" + result.Status
	}
	if result.Status == service.WechatRefundStatusProcessing {
		common.ApiSuccess(c, refund)
		return
	}
	if err := model.SettleTopUpRefund(refund.RefundNo, success, failReason, c.ClientIP()); err != nil {
		logger.LogError(ctx, fmt.Sprintf("微信支付退款 结算失败 refund_no=%s error=%q", refund.RefundNo, err.Error()))
		common.ApiErrorMsg(c, "结算退款失败")
		return
	}

	common.ApiSuccess(c, model.GetTopUpRefundByRefundNo(refund.RefundNo))
}

// GetTopUpRefunds 管理员查询某笔充值订单的退款记录。
func GetTopUpRefunds(c *gin.Context) {
	tradeNo := strings.TrimSpace(c.Query("trade_no"))
	if tradeNo == "" {
		common.ApiErrorMsg(c, "缺少订单号")
		return
	}
	refunds, err := model.GetTopUpRefundsByTradeNo(tradeNo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, refunds)
}
