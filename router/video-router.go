package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

func SetVideoRouter(router *gin.Engine) {
	// Video proxy: accepts either session auth (dashboard) or token auth (API clients)
	videoProxyRouter := router.Group("/v1")
	videoProxyRouter.Use(middleware.RouteTag("relay"))
	videoProxyRouter.Use(middleware.TokenOrUserAuth())
	{
		videoProxyRouter.GET("/videos/:task_id/content", controller.VideoProxy)
		// 视频模型能力声明：前端据此把做不到的组合直接置灰，与后端选路共用同一份数据。
		// 路径挂在 /video 下而不是 /videos，避免与 /videos/:task_id 这类通配路由产生歧义。
		videoProxyRouter.GET("/video/capabilities", controller.VideoCapabilities)
		// 提交前的价格预估（与真实计费共用同一套 helper），前端只负责展示。
		videoProxyRouter.POST("/video/estimate", controller.VideoEstimate)
		// 取消任务：POST /v1/videos/{task_id}/cancel 与 DELETE /v1/videos/{task_id} 等价。
		// 与下载接口一样接受会话或令牌鉴权，控制台与 API 客户端可共用。
		// 参数名必须与同方法下已有的 /v1/videos/:video_id/remix 保持一致（gin 的树不允许
		// 同一层级出现两个不同的通配名）。
		videoProxyRouter.POST("/videos/:video_id/cancel", controller.TaskCancel)
		videoProxyRouter.DELETE("/videos/:video_id", controller.TaskCancel)
	}

	videoV1Router := router.Group("/v1")
	videoV1Router.Use(middleware.RouteTag("relay"))
	videoV1Router.Use(middleware.TokenAuth(), middleware.Distribute())
	videoV1Router.Use(middleware.ModelRequestRateLimit(), middleware.ConcurrencyLimit())
	{
		videoV1Router.POST("/video/generations", controller.RelayTask)
		videoV1Router.GET("/video/generations/:task_id", controller.RelayTaskFetch)
		videoV1Router.POST("/videos/:video_id/remix", controller.RelayTask)
	}
	// openai compatible API video routes
	// docs: https://platform.openai.com/docs/api-reference/videos/create
	{
		videoV1Router.POST("/videos", controller.RelayTask)
		videoV1Router.GET("/videos/:task_id", controller.RelayTaskFetch)
	}

	klingV1Router := router.Group("/kling/v1")
	klingV1Router.Use(middleware.RouteTag("relay"))
	klingV1Router.Use(middleware.KlingRequestConvert(), middleware.TokenAuth(), middleware.Distribute())
	klingV1Router.Use(middleware.ModelRequestRateLimit(), middleware.ConcurrencyLimit())
	{
		klingV1Router.POST("/videos/text2video", controller.RelayTask)
		klingV1Router.POST("/videos/image2video", controller.RelayTask)
		klingV1Router.GET("/videos/text2video/:task_id", controller.RelayTaskFetch)
		klingV1Router.GET("/videos/image2video/:task_id", controller.RelayTaskFetch)
	}

	// Jimeng official API routes - direct mapping to official API format
	jimengOfficialGroup := router.Group("jimeng")
	jimengOfficialGroup.Use(middleware.RouteTag("relay"))
	jimengOfficialGroup.Use(middleware.JimengRequestConvert(), middleware.TokenAuth(), middleware.Distribute())
	jimengOfficialGroup.Use(middleware.ModelRequestRateLimit(), middleware.ConcurrencyLimit())
	{
		// Maps to: /?Action=CVSync2AsyncSubmitTask&Version=2022-08-31 and /?Action=CVSync2AsyncGetResult&Version=2022-08-31
		jimengOfficialGroup.POST("/", controller.RelayTask)
	}
}
