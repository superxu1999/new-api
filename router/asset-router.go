package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// SetAssetRouter 注册云端素材库接口。
//
// 与下载成片、取消任务一样挂 TokenOrUserAuth：控制台（会话）与 API 客户端（令牌）共用
// 同一套接口。素材本身由上游渠道托管，这里只做映射、代理与权限校验。
func SetAssetRouter(router *gin.Engine) {
	assetRouter := router.Group("/v1/assets")
	assetRouter.Use(middleware.RouteTag("relay"))
	assetRouter.Use(middleware.TokenOrUserAuth())
	{
		// 能力探测：回答「当前账号能用哪些素材能力、哪些渠道与模型支持素材」。
		assetRouter.GET("/capabilities", controller.AssetCapabilities)

		assetRouter.GET("/groups", controller.ListAssetGroups)
		assetRouter.POST("/groups", controller.CreateAssetGroup)
		assetRouter.PUT("/groups/:id", controller.UpdateAssetGroup)
		assetRouter.DELETE("/groups/:id", controller.DeleteAssetGroup)

		// 本地文件直传：先落盘暂存，再把公网地址交给上游入库（默认关闭，需管理员开通）。
		assetRouter.POST("/upload", controller.UploadAsset)

		assetRouter.GET("", controller.ListAssets)
		assetRouter.POST("", controller.CreateAsset)
		assetRouter.GET("/:id", controller.GetAsset)
		assetRouter.PUT("/:id", controller.UpdateAsset)
		assetRouter.DELETE("/:id", controller.DeleteAsset)

		assetRouter.GET("/real-person/sessions", controller.ListRealPersonSessions)
		assetRouter.POST("/real-person/sessions", controller.CreateRealPersonSession)
		assetRouter.GET("/real-person/sessions/:id", controller.GetRealPersonSession)
		// 取消认证只标记本地会话：上游不提供销毁认证会话的接口。
		assetRouter.POST("/real-person/sessions/:id/cancel", controller.CancelRealPersonSession)
	}

	// 暂存文件的下载入口：上游服务端要能匿名抓取，因此单独一条不鉴权路由，
	// 且路径不能落在 /assets（该前缀被 web-router 留给静态资源）。
	mediaRouter := router.Group("/asset-media")
	mediaRouter.Use(middleware.RouteTag("relay"))
	{
		mediaRouter.GET("/:key", controller.ServeAssetMedia)
	}

	// 真人认证短链：手机扫码后跳转到上游的认证页（上游链接过长，二维码扫不出来）。
	realPersonRouter := router.Group("/rp")
	realPersonRouter.Use(middleware.RouteTag("relay"))
	{
		realPersonRouter.GET("/:code", controller.RedirectRealPersonSession)
	}
}
