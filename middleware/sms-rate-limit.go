package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

const (
	SMSRateLimitMark       = "SM"
	SMSMaxRequests         = 1  // 60秒内最多1次
	SMSDuration            = 60 // 60秒时间窗口
)

func redisSMSRateLimiter(c *gin.Context) {
	ctx := context.Background()
	rdb := common.RDB
	key := "sms:" + SMSRateLimitMark + ":" + c.ClientIP()

	count, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		memorySMSRateLimiter(c)
		return
	}

	if count == 1 {
		_ = rdb.Expire(ctx, key, time.Duration(SMSDuration)*time.Second).Err()
	}

	if count <= int64(SMSMaxRequests) {
		c.Next()
		return
	}

	ttl, err := rdb.TTL(ctx, key).Result()
	waitSeconds := int64(SMSDuration)
	if err == nil && ttl > 0 {
		waitSeconds = int64(ttl.Seconds())
	}

	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": fmt.Sprintf("发送过于频繁，请等待 %d 秒后再试", waitSeconds),
	})
	c.Abort()
}

func memorySMSRateLimiter(c *gin.Context) {
	key := SMSRateLimitMark + ":" + c.ClientIP()

	if !inMemoryRateLimiter.Request(key, SMSMaxRequests, SMSDuration) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false,
			"message": "发送过于频繁，请稍后再试",
		})
		c.Abort()
		return
	}

	c.Next()
}

func SMSRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if common.RedisEnabled {
			redisSMSRateLimiter(c)
		} else {
			inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
			memorySMSRateLimiter(c)
		}
	}
}
