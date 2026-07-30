package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type homeProvider struct {
	Type int    `json:"type"`
	Name string `json:"name"`
}

// GetHomeProviders returns the distinct channel types of enabled channels,
// used by the default home page to render the provider marquee.
func GetHomeProviders(c *gin.Context) {
	var channelTypes []int
	err := model.DB.Model(&model.Channel{}).
		Where("status = ?", common.ChannelStatusEnabled).
		Distinct().
		Order("type").
		Pluck("type", &channelTypes).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
			"data":    []homeProvider{},
		})
		return
	}

	providers := make([]homeProvider, 0, len(channelTypes))
	for _, channelType := range channelTypes {
		providers = append(providers, homeProvider{
			Type: channelType,
			Name: constant.GetChannelTypeName(channelType),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    providers,
	})
}
