package service

import (
	"bytes"
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
)

// 微信支付 APIv3 直连（Native 扫码 + 退款）。
//
// 签名规则（https://pay.weixin.qq.com/doc/v3/merchant/4012365342）：
//
//	请求：Authorization: WECHATPAY2-SHA256-RSA2048 mchid="..",nonce_str="..",signature="..",timestamp="..",serial_no=".."
//	      待签名串 = 方法\nURL(含 query)\n时间戳\n随机串\n请求体\n
//	应答/回调：用微信支付公钥验证，待签名串 = 时间戳\n随机串\n报文体\n
//
// 回调报文里的 resource 使用 APIv3 密钥做 AES-256-GCM 解密。
const (
	wechatPayAPIBaseURL = "https://api.mch.weixin.qq.com"

	wechatPayNativeOrderPath = "/v3/pay/transactions/native"
	wechatPayRefundPath      = "/v3/refund/domestic/refunds"

	wechatPayAuthScheme = "WECHATPAY2-SHA256-RSA2048"

	// 回调时间戳允许的最大偏差，超出即拒绝，防重放。
	wechatPayTimestampSkew = 5 * time.Minute

	// 退款状态
	WechatRefundStatusSuccess    = "SUCCESS"
	WechatRefundStatusClosed     = "CLOSED"
	WechatRefundStatusProcessing = "PROCESSING"
	WechatRefundStatusAbnormal   = "ABNORMAL"

	// 支付状态
	WechatTradeStateSuccess = "SUCCESS"

	// 回调事件类型
	WechatEventTransactionSuccess = "TRANSACTION.SUCCESS"
	WechatEventRefundSuccess      = "REFUND.SUCCESS"
	WechatEventRefundAbnormal     = "REFUND.ABNORMAL"
	WechatEventRefundClosed       = "REFUND.CLOSED"
)

var (
	ErrWechatPayNotConfigured    = errors.New("微信支付未配置")
	ErrWechatPayNotifyInvalid    = errors.New("微信支付回调验签失败")
	ErrWechatPayResourceInvalid  = errors.New("微信支付回调解密失败")
	ErrWechatPayTimestampExpired = errors.New("微信支付回调时间戳超出允许范围")
)

// WechatPayClient 一次请求生命周期内复用；配置变更后需重新构造。
type WechatPayClient struct {
	mchId        string
	appId        string
	apiV3Key     string
	certSerialNo string
	privateKey   *rsa.PrivateKey
	publicKey    *rsa.PublicKey
	publicKeyId  string
	httpClient   *http.Client
}

type WechatPayNotification struct {
	Id           string `json:"id"`
	CreateTime   string `json:"create_time"`
	EventType    string `json:"event_type"`
	ResourceType string `json:"resource_type"`
	Summary      string `json:"summary"`
	Resource     struct {
		Algorithm      string `json:"algorithm"`
		Ciphertext     string `json:"ciphertext"`
		AssociatedData string `json:"associated_data"`
		Nonce          string `json:"nonce"`
		OriginalType   string `json:"original_type"`
	} `json:"resource"`
}

type WechatPayTransaction struct {
	AppId          string `json:"appid"`
	MchId          string `json:"mchid"`
	OutTradeNo     string `json:"out_trade_no"`
	TransactionId  string `json:"transaction_id"`
	TradeType      string `json:"trade_type"`
	TradeState     string `json:"trade_state"`
	TradeStateDesc string `json:"trade_state_desc"`
	SuccessTime    string `json:"success_time"`
	Amount         struct {
		Total         int64  `json:"total"`
		PayerTotal    int64  `json:"payer_total"`
		Currency      string `json:"currency"`
		PayerCurrency string `json:"payer_currency"`
	} `json:"amount"`
}

type WechatPayRefundResult struct {
	RefundId            string `json:"refund_id"`
	OutRefundNo         string `json:"out_refund_no"`
	TransactionId       string `json:"transaction_id"`
	OutTradeNo          string `json:"out_trade_no"`
	Status              string `json:"status"`
	SuccessTime         string `json:"success_time"`
	UserReceivedAccount string `json:"user_received_account"`
	Amount              struct {
		Total       int64  `json:"total"`
		Refund      int64  `json:"refund"`
		PayerTotal  int64  `json:"payer_total"`
		PayerRefund int64  `json:"payer_refund"`
		Currency    string `json:"currency"`
	} `json:"amount"`
}

type wechatPayNativeOrderResponse struct {
	CodeUrl string `json:"code_url"`
}

type wechatPayErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// NewWechatPayClient 读取当前配置构造客户端。任一必填项缺失即返回 ErrWechatPayNotConfigured，
// 调用方据此判断网关是否可用。
func NewWechatPayClient() (*WechatPayClient, error) {
	mchId := strings.TrimSpace(setting.WechatMchId)
	appId := strings.TrimSpace(setting.WechatAppId)
	apiV3Key := strings.TrimSpace(setting.WechatApiV3Key)
	certSerialNo := strings.TrimSpace(setting.WechatCertSerialNo)
	privateKeyPem := strings.TrimSpace(setting.WechatPrivateKey)
	publicKeyPem := strings.TrimSpace(setting.WechatPublicKeyPem)
	publicKeyId := strings.TrimSpace(setting.WechatPublicKeyId)

	missing := make([]string, 0, 6)
	if mchId == "" {
		missing = append(missing, "商户号")
	}
	if appId == "" {
		missing = append(missing, "AppID")
	}
	if apiV3Key == "" {
		missing = append(missing, "APIv3密钥")
	}
	if certSerialNo == "" {
		missing = append(missing, "证书序列号")
	}
	if privateKeyPem == "" {
		missing = append(missing, "商户API证书私钥")
	}
	if publicKeyPem == "" {
		missing = append(missing, "微信支付公钥")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("%w：缺少 %s", ErrWechatPayNotConfigured, strings.Join(missing, "、"))
	}
	if len(apiV3Key) != 32 {
		return nil, errors.New("APIv3密钥必须是 32 位")
	}

	privateKey, err := parseRSAPrivateKey(privateKeyPem)
	if err != nil {
		return nil, fmt.Errorf("商户API证书私钥解析失败: %w", err)
	}
	publicKey, err := parseRSAPublicKey(publicKeyPem)
	if err != nil {
		return nil, fmt.Errorf("微信支付公钥解析失败: %w", err)
	}

	return &WechatPayClient{
		mchId:        mchId,
		appId:        appId,
		apiV3Key:     apiV3Key,
		certSerialNo: certSerialNo,
		privateKey:   privateKey,
		publicKey:    publicKey,
		publicKeyId:  publicKeyId,
		httpClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ForceAttemptHTTP2: true},
		},
	}, nil
}

// NativeOrder 调用 Native 下单，返回可生成二维码的 code_url。
// totalFen 单位为分，必须是正整数。
func (c *WechatPayClient) NativeOrder(ctx context.Context, outTradeNo string, description string, totalFen int64, notifyUrl string) (string, error) {
	if totalFen <= 0 {
		return "", errors.New("订单金额必须大于 0")
	}
	if strings.TrimSpace(notifyUrl) == "" {
		return "", errors.New("缺少回调地址")
	}

	payload := map[string]any{
		"appid":        c.appId,
		"mchid":        c.mchId,
		"description":  truncateRunes(description, 127),
		"out_trade_no": outTradeNo,
		"notify_url":   notifyUrl,
		"amount": map[string]any{
			"total":    totalFen,
			"currency": "CNY",
		},
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return "", err
	}

	var resp wechatPayNativeOrderResponse
	if err := c.doJSON(ctx, http.MethodPost, wechatPayNativeOrderPath, body, &resp); err != nil {
		return "", err
	}
	if resp.CodeUrl == "" {
		return "", errors.New("微信支付未返回 code_url")
	}
	return resp.CodeUrl, nil
}

// Refund 发起退款。refundFen / totalFen 单位为分，refundFen 不得超过 totalFen。
func (c *WechatPayClient) Refund(ctx context.Context, outRefundNo string, outTradeNo string, reason string, refundFen int64, totalFen int64, notifyUrl string) (*WechatPayRefundResult, error) {
	if refundFen <= 0 {
		return nil, errors.New("退款金额必须大于 0")
	}
	if refundFen > totalFen {
		return nil, errors.New("退款金额不能大于订单金额")
	}

	payload := map[string]any{
		"out_trade_no":  outTradeNo,
		"out_refund_no": outRefundNo,
		"notify_url":    notifyUrl,
		"amount": map[string]any{
			"refund":   refundFen,
			"total":    totalFen,
			"currency": "CNY",
		},
	}
	if trimmed := truncateRunes(strings.TrimSpace(reason), 80); trimmed != "" {
		payload["reason"] = trimmed
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}

	var resp WechatPayRefundResult
	if err := c.doJSON(ctx, http.MethodPost, wechatPayRefundPath, body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// QueryRefund 按商户退款单号查询退款结果，用于回调不可达时的补偿对账。
func (c *WechatPayClient) QueryRefund(ctx context.Context, outRefundNo string) (*WechatPayRefundResult, error) {
	if strings.TrimSpace(outRefundNo) == "" {
		return nil, errors.New("缺少商户退款单号")
	}
	path := wechatPayRefundPath + "/" + url.PathEscape(outRefundNo)

	var resp WechatPayRefundResult
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// DecryptNotification 验签并解密回调报文，返回事件类型与明文。
func (c *WechatPayClient) DecryptNotification(header http.Header, body []byte) (string, []byte, error) {
	if err := c.verifyNotifySignature(header, body); err != nil {
		return "", nil, err
	}

	var notification WechatPayNotification
	if err := common.Unmarshal(body, &notification); err != nil {
		return "", nil, fmt.Errorf("回调报文解析失败: %w", err)
	}
	if strings.ToUpper(notification.Resource.Algorithm) != "AEAD_AES_256_GCM" {
		return "", nil, fmt.Errorf("不支持的回调加密算法: %s", notification.Resource.Algorithm)
	}

	plaintext, err := decryptAESGCM(c.apiV3Key, notification.Resource.Nonce, notification.Resource.AssociatedData, notification.Resource.Ciphertext)
	if err != nil {
		return "", nil, fmt.Errorf("%w: %v", ErrWechatPayResourceInvalid, err)
	}
	return notification.EventType, plaintext, nil
}

func (c *WechatPayClient) doJSON(ctx context.Context, method string, path string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, wechatPayAPIBaseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	authorization, err := c.buildAuthorization(method, path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", authorization)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode/100 != 2 {
		var apiErr wechatPayErrorResponse
		if common.Unmarshal(respBody, &apiErr) == nil && apiErr.Message != "" {
			return fmt.Errorf("微信支付接口错误 [%s] %s", apiErr.Code, apiErr.Message)
		}
		return fmt.Errorf("微信支付接口返回状态码 %d", resp.StatusCode)
	}

	if err := c.verifyResponseSignature(resp.Header, respBody); err != nil {
		return err
	}

	if out == nil {
		return nil
	}
	if err := common.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("微信支付应答解析失败: %w", err)
	}
	return nil
}

func (c *WechatPayClient) buildAuthorization(method string, path string, body []byte) (string, error) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce, err := randomHex(16)
	if err != nil {
		return "", err
	}

	message := strings.Join([]string{method, path, timestamp, nonce, string(body)}, "\n") + "\n"
	digest := sha256.Sum256([]byte(message))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}

	return fmt.Sprintf(`%s mchid="%s",nonce_str="%s",signature="%s",timestamp="%s",serial_no="%s"`,
		wechatPayAuthScheme, c.mchId, nonce, base64.StdEncoding.EncodeToString(signature), timestamp, c.certSerialNo), nil
}

func (c *WechatPayClient) verifyResponseSignature(header http.Header, body []byte) error {
	signature := strings.TrimSpace(header.Get("Wechatpay-Signature"))
	if signature == "" {
		// 没有签名头的应答无法验证，拒绝以免接受被篡改的内容。
		return errors.New("微信支付应答缺少 Wechatpay-Signature")
	}
	if err := verifyWechatMessage(c.publicKey, header.Get("Wechatpay-Timestamp"), header.Get("Wechatpay-Nonce"), body, signature); err != nil {
		return fmt.Errorf("微信支付应答验签失败: %w", err)
	}
	return nil
}

func (c *WechatPayClient) verifyNotifySignature(header http.Header, body []byte) error {
	signature := strings.TrimSpace(header.Get("Wechatpay-Signature"))
	if signature == "" {
		return fmt.Errorf("%w：缺少 Wechatpay-Signature", ErrWechatPayNotifyInvalid)
	}
	if serial := strings.TrimSpace(header.Get("Wechatpay-Serial")); c.publicKeyId != "" && serial != "" && serial != c.publicKeyId {
		return fmt.Errorf("%w：公钥 ID 不匹配（收到 %s，期望 %s）", ErrWechatPayNotifyInvalid, serial, c.publicKeyId)
	}
	if err := verifyWechatMessage(c.publicKey, header.Get("Wechatpay-Timestamp"), header.Get("Wechatpay-Nonce"), body, signature); err != nil {
		return fmt.Errorf("%w: %v", ErrWechatPayNotifyInvalid, err)
	}
	return nil
}

func verifyWechatMessage(publicKey *rsa.PublicKey, timestamp string, nonce string, body []byte, signature string) error {
	ts, err := strconv.ParseInt(strings.TrimSpace(timestamp), 10, 64)
	if err != nil {
		return errors.New("时间戳无效")
	}
	if skew := time.Since(time.Unix(ts, 0)); skew > wechatPayTimestampSkew || skew < -wechatPayTimestampSkew {
		return ErrWechatPayTimestampExpired
	}
	if strings.TrimSpace(nonce) == "" {
		return errors.New("随机串为空")
	}

	signatureBytes, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return errors.New("签名字段不是合法的 base64")
	}

	message := strings.Join([]string{timestamp, nonce, string(body)}, "\n") + "\n"
	digest := sha256.Sum256([]byte(message))
	return rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], signatureBytes)
}

func decryptAESGCM(apiV3Key string, nonce string, associatedData string, ciphertext string) ([]byte, error) {
	block, err := aes.NewCipher([]byte(apiV3Key))
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, errors.New("密文不是合法的 base64")
	}
	if len(nonce) != aead.NonceSize() {
		return nil, fmt.Errorf("nonce 长度应为 %d", aead.NonceSize())
	}
	return aead.Open(nil, []byte(nonce), data, []byte(associatedData))
}

func parseRSAPrivateKey(pemText string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(normalizePem(pemText)))
	if block == nil {
		return nil, errors.New("不是合法的 PEM 内容")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("私钥不是 RSA 类型")
		}
		return rsaKey, nil
	}
	return x509.ParsePKCS1PrivateKey(block.Bytes)
}

func parseRSAPublicKey(pemText string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(normalizePem(pemText)))
	if block == nil {
		return nil, errors.New("不是合法的 PEM 内容")
	}
	if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
		rsaKey, ok := cert.PublicKey.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("证书公钥不是 RSA 类型")
		}
		return rsaKey, nil
	}
	if pub, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		rsaKey, ok := pub.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("公钥不是 RSA 类型")
		}
		return rsaKey, nil
	}
	return x509.ParsePKCS1PublicKey(block.Bytes)
}

// normalizePem 把管理员粘贴的内容还原成标准 PEM。
//
// 微信证书工具生成的文件在复制粘贴或经 JSON / 环境变量传递后常态失真：
//   - 换行丢失（正文挤成一行，pem.Decode 直接失败）
//   - 换行被转义成字面量 "\n"
//   - 所有空白（包括标题行内部的空格）被剥掉，变成 "-----BEGINPRIVATEKEY-----"
//
// 这里统一按标题行重建，正文按 64 字折行，因此对上述形态都成立。
func normalizePem(pemText string) string {
	text := strings.TrimSpace(pemText)
	text = strings.ReplaceAll(text, `\r\n`, "\n")
	text = strings.ReplaceAll(text, `\n`, "\n")

	const (
		beginTag = "-----BEGIN"
		endTag   = "-----END"
		dashes   = "-----"
	)

	beginIdx := strings.Index(text, beginTag)
	if beginIdx < 0 {
		return text + "\n"
	}
	labelStart := beginIdx + len(beginTag)
	labelClose := strings.Index(text[labelStart:], dashes)
	if labelClose < 0 {
		return text + "\n"
	}
	label := strings.TrimSpace(text[labelStart : labelStart+labelClose])
	headerEnd := labelStart + labelClose + len(dashes)

	endIdx := strings.Index(text[headerEnd:], endTag)
	if endIdx < 0 {
		return text + "\n"
	}
	endIdx += headerEnd
	endLabelStart := endIdx + len(endTag)
	endLabelClose := strings.Index(text[endLabelStart:], dashes)
	if endLabelClose < 0 {
		return text + "\n"
	}
	endLabel := strings.TrimSpace(text[endLabelStart : endLabelStart+endLabelClose])

	body := strings.Join(strings.Fields(text[headerEnd:endIdx]), "")
	if label == "" || body == "" {
		return text + "\n"
	}

	var builder strings.Builder
	builder.WriteString(beginTag)
	builder.WriteString(" ")
	builder.WriteString(label)
	builder.WriteString(dashes)
	builder.WriteString("\n")
	for i := 0; i < len(body); i += 64 {
		end := i + 64
		if end > len(body) {
			end = len(body)
		}
		builder.WriteString(body[i:end])
		builder.WriteString("\n")
	}
	builder.WriteString(endTag)
	builder.WriteString(" ")
	builder.WriteString(endLabel)
	builder.WriteString(dashes)
	builder.WriteString("\n")
	return builder.String()
}

func randomHex(byteLen int) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func truncateRunes(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}

// WechatMoneyToFen 把本地货币金额转成分，金额非法或超出 int64 安全范围时返回错误。
func WechatMoneyToFen(money float64) (int64, error) {
	if math.IsNaN(money) || math.IsInf(money, 0) || money <= 0 {
		return 0, errors.New("金额非法")
	}
	fen := math.Round(money * 100)
	if fen > math.MaxInt64/2 {
		return 0, errors.New("金额过大")
	}
	return int64(fen), nil
}
