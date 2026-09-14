package setting

// 微信支付直连（Native 扫码）配置。
//
// 未配置时网关不启用（见 controller/payment_webhook_availability.go 的
// isWechatTopUpEnabled），行为与 Stripe / Creem / Waffo 保持一致：不出现在充值页，
// 回调入口直接拒绝。
//
// 注意：商户 API 证书私钥与 APIv3 密钥属于机密，选项键以 "Key" 结尾，
// 会被 controller.GetOptions 的敏感键过滤掉，不会下发给前端。
var (
	// WechatMchId 直连商户号。
	WechatMchId string
	// WechatAppId 与商户号绑定的公众号 / 小程序 / 移动应用 AppID。Native 下单必填。
	WechatAppId string
	// WechatApiV3Key 32 位 APIv3 密钥，仅用于解密回调与应答中的敏感字段，不参与请求签名。
	WechatApiV3Key string
	// WechatCertSerialNo 商户 API 证书序列号，与 WechatPrivateKey 必须成对。
	WechatCertSerialNo string
	// WechatPrivateKey 商户 API 证书私钥（apiclient_key.pem）的 PEM 文本，用于请求签名。
	WechatPrivateKey string
	// WechatPublicKeyPem 微信支付公钥（PEM 文本），用于验证应答与回调的签名。
	// 相比每五年更换一次的平台证书，公钥长期有效。
	WechatPublicKeyPem string
	// WechatPublicKeyId 微信支付公钥 ID，对应应答头 Wechatpay-Serial。
	WechatPublicKeyId string
	// WechatUnitPrice 每 1 美元余额收取的本地货币金额，与 Price / StripeUnitPrice 同义。
	WechatUnitPrice float64 = 1.0
	// WechatMinTopUp 最低充值金额（美元余额单位）。
	WechatMinTopUp int = 1
)
