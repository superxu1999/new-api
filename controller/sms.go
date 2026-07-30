package controller

import (
	"fmt"
	"net/http"
	"regexp"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

var phoneRegex = regexp.MustCompile(`^1[3-9]\d{9}$`)

func isValidPhone(phone string) bool {
	return phoneRegex.MatchString(phone)
}

// SendSMSVerification sends a verification code to the given phone number.
// It checks SMS is enabled, validates phone format, checks phone uniqueness
// (for registration), and sends the code via the configured SMS provider.
func SendSMSVerification(c *gin.Context) {
	if !common.SMSEnabled {
		common.ApiErrorI18n(c, i18n.MsgUserSMSNotEnabled)
		return
	}

	phone := c.Query("phone")
	if phone == "" {
		phone = c.Query("mobile")
	}
	phone = trimPhone(phone)

	if !isValidPhone(phone) {
		common.ApiErrorI18n(c, i18n.MsgUserPhoneInvalid)
		return
	}

	// Check phone availability (for registration flow)
	// For login, we only check if a user with this phone exists
	purpose := c.Query("purpose") // "login" or "register"
	if purpose == "register" {
		exists, err := model.CheckPhoneExists(phone)
		if err != nil {
			common.SysLog(fmt.Sprintf("CheckPhoneExists error: %v", err))
			common.ApiErrorI18n(c, i18n.MsgDatabaseError)
			return
		}
		if exists {
			common.ApiErrorI18n(c, i18n.MsgUserPhoneAlreadyTaken)
			return
		}
	}

	code := common.GenerateVerificationCode(6)
	common.RegisterVerificationCodeWithKey(phone, code, common.SMSVerificationPurpose)

	err := common.SendSMS(phone, code)
	if err != nil {
		common.SysLog(fmt.Sprintf("SendSMS error for %s: %v", phone, err))
		common.ApiErrorI18n(c, i18n.MsgOperationFailed)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

// trimPhone removes common phone number prefixes like +86 for normalization
func trimPhone(phone string) string {
	if len(phone) >= 3 && phone[:3] == "+86" {
		phone = phone[3:]
	}
	return phone
}
