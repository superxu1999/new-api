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
		assetRouter.GET("/groups", controller.ListAssetGroups)
		assetRouter.POST("/groups", controller.CreateAssetGroup)
		assetRouter.GET("/groups/:id", controller.GetAssetGroup)
		assetRouter.DELETE("/groups/:id", controller.DeleteAssetGroup)

		assetRouter.GET("", controller.ListAssets)
		assetRouter.POST("", controller.CreateAsset)
		assetRouter.GET("/:id", controller.GetAsset)
		assetRouter.PUT("/:id", controller.UpdateAsset)
		assetRouter.DELETE("/:id", controller.DeleteAsset)

		assetRouter.POST("/real-person/sessions", controller.CreateRealPersonSession)
		assetRouter.GET("/real-person/sessions/:id", controller.GetRealPersonSession)
	}
}
