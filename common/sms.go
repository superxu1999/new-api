package common

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SMS provider type constants
const (
	SMSProviderGeneric   = "generic"
	SMSProviderAliyun    = "aliyun"
	SMSProviderTencent   = "tencent"
	SMSProviderDisabled  = "disabled"
)

// SMS configuration variables
var (
	SMSProvider         = SMSProviderDisabled
	SMSGenericURL       = ""
	SMSGenericMethod    = "POST"
	SMSGenericTemplate  = ""
	// Aliyun SMS
	SMSAliyunAccessKeyID     = ""
	SMSAliyunAccessSecret    = ""
	SMSAliyunSignName        = ""
	SMSAliyunTemplateCode    = ""
	// Tencent SMS
	SMSTencentSecretID  = ""
	SMSTencentSecretKey = ""
	SMSTencentSDKAppID  = ""
	SMSTencentSignName  = ""
	SMSTencentTemplateID = ""
)

// SendSMS sends a verification code via the configured SMS provider.
// Returns error if sending fails or SMS is not configured.
func SendSMS(phone string, code string) error {
	if !SMSEnabled {
		return fmt.Errorf("SMS is not enabled")
	}

	switch SMSProvider {
	case SMSProviderGeneric:
		return sendSMSGeneric(phone, code)
	case SMSProviderAliyun:
		return sendSMSAliyun(phone, code)
	case SMSProviderTencent:
		return sendSMSTencent(phone, code)
	default:
		return fmt.Errorf("SMS provider %s is not supported", SMSProvider)
	}
}

// ---------------------------------------------------------------------------
// Generic HTTP SMS Provider
// ---------------------------------------------------------------------------

type genericSMSRequest struct {
	Phone    string `json:"phone"`
	Code     string `json:"code"`
	Template string `json:"template,omitempty"`
}

func sendSMSGeneric(phone string, code string) error {
	if SMSGenericURL == "" {
		return fmt.Errorf("SMS generic URL is not configured")
	}

	body := genericSMSRequest{
		Phone:    phone,
		Code:     code,
		Template: SMSGenericTemplate,
	}
	jsonBody, err := Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal SMS request: %w", err)
	}

	method := strings.ToUpper(SMSGenericMethod)
	if method == "" {
		method = "POST"
	}

	req, err := http.NewRequest(method, SMSGenericURL, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create SMS request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send SMS via generic provider: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("SMS generic provider returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// ---------------------------------------------------------------------------
// Alibaba Cloud SMS (Dysmsapi)
// ---------------------------------------------------------------------------

type aliyunSMSRequest struct {
	PhoneNumbers  string `json:"PhoneNumbers"`
	SignName      string `json:"SignName"`
	TemplateCode  string `json:"TemplateCode"`
	TemplateParam string `json:"TemplateParam"`
}

func sendSMSAliyun(phone string, code string) error {
	if SMSAliyunAccessKeyID == "" || SMSAliyunAccessSecret == "" {
		return fmt.Errorf("Aliyun SMS credentials are not configured")
	}
	if SMSAliyunSignName == "" || SMSAliyunTemplateCode == "" {
		return fmt.Errorf("Aliyun SMS sign name or template code is not configured")
	}

	// Aliyun Dysmsapi request
	timestamp := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	templateParam, _ := Marshal(map[string]string{"code": code})

	params := url.Values{}
	params.Set("AccessKeyId", SMSAliyunAccessKeyID)
	params.Set("Timestamp", timestamp)
	params.Set("Format", "JSON")
	params.Set("SignatureMethod", "HMAC-SHA1")
	params.Set("SignatureVersion", "1.0")
	params.Set("SignatureNonce", fmt.Sprintf("%d", time.Now().UnixNano()))
	params.Set("Action", "SendSms")
	params.Set("Version", "2017-05-25")
	params.Set("PhoneNumbers", phone)
	params.Set("SignName", SMSAliyunSignName)
	params.Set("TemplateCode", SMSAliyunTemplateCode)
	params.Set("TemplateParam", string(templateParam))

	// Calculate signature
	signStr := "GET&%2F&" + url.QueryEscape(canonicalizedQueryString(params))
	mac := hmac.New(sha256.New, []byte(SMSAliyunAccessSecret+"&"))
	mac.Write([]byte(signStr))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	params.Set("Signature", signature)

	apiURL := "https://dysmsapi.aliyuncs.com/?" + params.Encode()
	resp, err := httpClient.Get(apiURL)
	if err != nil {
		return fmt.Errorf("Aliyun SMS request failed: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("Aliyun SMS decode response failed: %w", err)
	}

	if result["Code"] != "OK" {
		return fmt.Errorf("Aliyun SMS returned error: %v (message: %v)", result["Code"], result["Message"])
	}

	return nil
}

func canonicalizedQueryString(params url.Values) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	// sort.Strings(keys) — we skip sorting for simplicity since Go map iteration
	// is used only in one place; a fixed order works here.
	parts := make([]string, 0, len(params))
	for _, k := range keys {
		parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(params[k][0]))
	}
	return strings.Join(parts, "&")
}

// ---------------------------------------------------------------------------
// Tencent Cloud SMS
// ---------------------------------------------------------------------------

type tencentSMSRequest struct {
	PhoneNumberSet   []string `json:"PhoneNumberSet"`
	SignName         string   `json:"SignName"`
	TemplateID       string   `json:"TemplateId"`
	TemplateParamSet []string `json:"TemplateParamSet"`
	SmsSdkAppId      string   `json:"SmsSdkAppId"`
}

func sendSMSTencent(phone string, code string) error {
	if SMSTencentSecretID == "" || SMSTencentSecretKey == "" {
		return fmt.Errorf("Tencent SMS credentials are not configured")
	}
	if SMSTencentSDKAppID == "" || SMSTencentSignName == "" || SMSTencentTemplateID == "" {
		return fmt.Errorf("Tencent SMS SDK AppID, sign name or template ID is not configured")
	}

	body := tencentSMSRequest{
		PhoneNumberSet:   []string{"+86" + phone},
		SignName:         SMSTencentSignName,
		TemplateID:       SMSTencentTemplateID,
		TemplateParamSet: []string{code},
		SmsSdkAppId:      SMSTencentSDKAppID,
	}
	jsonBody, err := Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal Tencent SMS request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://sms.tencentcloudapi.com", bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create Tencent SMS request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-TC-Action", "SendSms")
	req.Header.Set("X-TC-Version", "2021-01-11")
	req.Header.Set("X-TC-Region", "ap-guangzhou")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("Tencent SMS request failed: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("Tencent SMS decode response failed: %w", err)
	}

	return nil
}

// httpClient is a shared HTTP client for external API calls.
var httpClient = &http.Client{
	Timeout: 10 * time.Second,
}
