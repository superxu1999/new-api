// 移动云（AICC）素材接口：与火山方舟的动作式入口不同，移动云是一组 REST 接口。
// 这里把上层的素材动作名翻译成对应的 REST 调用，使控制器无需区分两套协议。
//
// 对应关系（详见上游文档 §11.6）：
//
//	ListAssetGroups           GET    /api/v1/aicc/asset-groups
//	CreateAssetGroup          POST   /api/v1/aicc/asset-groups
//	UpdateAssetGroup          PUT    /api/v1/aicc/asset-groups/{id}
//	DeleteAssetGroup          DELETE /api/v1/aicc/asset-groups/{id}
//	ListAssets                GET    /api/v1/aicc/assets
//	CreateAsset               POST   /api/v1/aicc/assets
//	GetAsset                  GET    /api/v1/aicc/assets/{id}
//	UpdateAsset               PUT    /api/v1/aicc/assets/{id}
//	DeleteAsset               DELETE /api/v1/aicc/assets/{id}
//	CreateVisualValidateSession POST /api/v1/aicc/real-person-auth/sessions
//	GetVisualValidateResult     POST /api/v1/aicc/real-person-auth/asset-group
package seedance

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
)

// aiccAssetPrefix 是移动云素材接口的路径前缀。
const aiccAssetPrefix = "/api/v1/aicc"

// AssetAction 把统一的素材动作翻译成移动云 REST 调用。
func (a *TaskAdaptor) AssetAction(baseUrl string, key string, proxy string, action string, payload map[string]any) (*http.Response, error) {
	origin, err := aiccOrigin(baseUrl)
	if err != nil {
		return nil, err
	}
	method := http.MethodGet
	path := ""
	body := map[string]any(nil)
	query := url.Values{}

	switch action {
	case "ListAssetGroups":
		path = aiccAssetPrefix + "/asset-groups"
		query.Set("page_no", pageParam(payload, "PageNumber"))
		query.Set("page_size", pageParam(payload, "PageSize"))
		if groupType := payloadString(payload, "GroupType"); groupType != "" {
			query.Set("group_type", groupType)
		}
		if name := payloadString(payload, "Name"); name != "" {
			query.Set("group_name", name)
		}
	case "CreateAssetGroup":
		method = http.MethodPost
		path = aiccAssetPrefix + "/asset-groups"
		body = map[string]any{
			"group_name":  payloadString(payload, "Name"),
			"description": payloadString(payload, "Description"),
			"group_type":  firstNonEmpty(payloadString(payload, "GroupType"), "AIGC"),
			"is_default":  false,
		}
	case "UpdateAssetGroup":
		method = http.MethodPut
		path = aiccAssetPrefix + "/asset-groups/" + url.PathEscape(payloadString(payload, "Id"))
		body = map[string]any{}
		if name := payloadString(payload, "Name"); name != "" {
			body["group_name"] = name
		}
		if description := payloadString(payload, "Description"); description != "" {
			body["description"] = description
		}
	case "DeleteAssetGroup":
		method = http.MethodDelete
		path = aiccAssetPrefix + "/asset-groups/" + url.PathEscape(payloadString(payload, "Id"))
	case "ListAssets":
		path = aiccAssetPrefix + "/assets"
		query.Set("page_no", pageParam(payload, "PageNumber"))
		query.Set("page_size", pageParam(payload, "PageSize"))
		if assetName := payloadString(payload, "Name"); assetName != "" {
			query.Set("asset_name", assetName)
		}
		if statuses := payloadStringSlice(payload, "Statuses"); len(statuses) > 0 {
			query.Set("statuses", strings.Join(statuses, ","))
		}
	case "CreateAsset":
		method = http.MethodPost
		path = aiccAssetPrefix + "/assets"
		body = map[string]any{
			"group_id":   payloadString(payload, "GroupId"),
			"asset_name": payloadString(payload, "Name"),
			"asset_url":  payloadString(payload, "URL"),
			"asset_type": payloadString(payload, "AssetType"),
		}
	case "GetAsset":
		path = aiccAssetPrefix + "/assets/" + url.PathEscape(payloadString(payload, "Id"))
	case "UpdateAsset":
		method = http.MethodPut
		path = aiccAssetPrefix + "/assets/" + url.PathEscape(payloadString(payload, "Id"))
		body = map[string]any{"asset_name": payloadString(payload, "Name")}
	case "DeleteAsset":
		method = http.MethodDelete
		path = aiccAssetPrefix + "/assets/" + url.PathEscape(payloadString(payload, "Id"))
	case "CreateVisualValidateSession":
		method = http.MethodPost
		path = aiccAssetPrefix + "/real-person-auth/sessions"
		body = map[string]any{}
	case "GetVisualValidateResult":
		method = http.MethodPost
		path = aiccAssetPrefix + "/real-person-auth/asset-group"
		// 上游要求下划线写法，而本站内部统一用 BytedToken。
		body = map[string]any{"byted_token": payloadString(payload, "BytedToken")}
	default:
		return nil, fmt.Errorf("unsupported asset action %q for CMCC channel", action)
	}

	uri := origin + path
	if encoded := query.Encode(); encoded != "" {
		uri += "?" + encoded
	}
	var reader io.Reader
	if body != nil {
		raw, err := common.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, uri, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

// AssetProbe 用一次只读的素材列表确认该渠道确实开放了素材接口：
// 素材组列表在「尚无素材组」时返回业务 404，不适合做探测，素材列表则总是 2xx。
func (a *TaskAdaptor) AssetProbe(baseUrl string, key string, proxy string) (*http.Response, error) {
	return a.AssetAction(baseUrl, key, proxy, "ListAssets", map[string]any{
		"PageNumber": 1,
		"PageSize":   1,
	})
}

// aiccOrigin 从渠道 base 取出 scheme://host；移动云的素材接口挂在主机根路径下，
// 而渠道 base 往往带 /api/v3 这类前缀，因此不能直接用 base 拼接。
func aiccOrigin(baseUrl string) (string, error) {
	trimmed := strings.TrimSpace(baseUrl)
	if trimmed == "" {
		return "", fmt.Errorf("channel base url is empty")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid channel base url %q: %w", trimmed, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("channel base url %q must be absolute", trimmed)
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func payloadString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func payloadStringSlice(payload map[string]any, key string) []string {
	if payload == nil {
		return nil
	}
	raw, ok := payload[key].([]string)
	if !ok {
		return nil
	}
	return raw
}

func pageParam(payload map[string]any, key string) string {
	value := payloadString(payload, key)
	if value == "" {
		return "1"
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
