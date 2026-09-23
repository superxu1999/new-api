package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"log"
	"os"
	"strings"
)

// passwordEncKey 非空表示「密码可逆存储（管理端回显）」功能已启用。
//
// 该功能是显式 opt-in：只有配置了重启后仍然稳定的密钥才会启用。它只是给管理端
// 「编辑用户」提供一份可解密副本，登录校验始终走 Password 列上的 bcrypt 哈希，
// 该密钥与密文都不参与认证。
var passwordEncKey []byte

// InitPasswordEncryption 初始化密码可逆存储的密钥。
//
// 优先级：PASSWORD_ENC_KEY > CRYPTO_SECRET(环境变量) > SESSION_SECRET(环境变量)。
// 三者都未显式配置时保持关闭：此时 SessionSecret 是每次启动随机生成的 UUID，
// 用它加密会让密文在重启后无法解密（表现为密码回显突然变空）。
func InitPasswordEncryption() {
	raw := strings.TrimSpace(os.Getenv("PASSWORD_ENC_KEY"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("CRYPTO_SECRET"))
	}
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("SESSION_SECRET"))
	}
	if raw == "" {
		log.Println("password reveal disabled: set PASSWORD_ENC_KEY (or CRYPTO_SECRET / SESSION_SECRET) to enable it")
		return
	}
	sum := sha256.Sum256([]byte("new-api-password-enc:v1:" + raw))
	passwordEncKey = sum[:]
}

// HashAndEncryptPassword 一次性产出密码的两种存储形态：
// hash 用于登录校验（bcrypt，始终存在），encrypted 是可解密副本（功能未启用时为空串）。
// 所有写入密码的路径都必须走这里，避免只哈希不加密导致管理端回显为空。
func HashAndEncryptPassword(password string) (hash string, encrypted string, err error) {
	encrypted, err = EncryptPassword(password)
	if err != nil {
		return "", "", err
	}
	hash, err = Password2Hash(password)
	if err != nil {
		return "", "", err
	}
	return hash, encrypted, nil
}

// EncryptPassword 用 AES-256-GCM 生成密码的可解密副本。
// 功能未启用或密码为空时返回空串，调用方据此跳过写入。
func EncryptPassword(password string) (string, error) {
	if len(passwordEncKey) == 0 || password == "" {
		return "", nil
	}
	gcm, err := newPasswordGCM()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(password), nil)), nil
}

// DecryptPassword 解密密码副本。
// 功能未启用、密文为空、密钥已更换或数据损坏时统一返回空串：回显为空即可，
// 绝不能因为解密失败影响登录、列表等其它功能。
func DecryptPassword(encoded string) string {
	if len(passwordEncKey) == 0 || encoded == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	gcm, err := newPasswordGCM()
	if err != nil {
		return ""
	}
	if len(raw) < gcm.NonceSize() {
		return ""
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return ""
	}
	return string(plain)
}

func newPasswordGCM() (cipher.AEAD, error) {
	block, err := aes.NewCipher(passwordEncKey)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
