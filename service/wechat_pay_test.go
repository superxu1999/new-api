package service

import (
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testAPIv3Key = "12345678901234567890123456789012"

func newTestRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return key
}

func encodePrivateKeyPem(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func encodePublicKeyPem(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func signWechatMessage(t *testing.T, key *rsa.PrivateKey, timestamp, nonce string, body []byte) string {
	t.Helper()
	message := strings.Join([]string{timestamp, nonce, string(body)}, "\n") + "\n"
	digest := sha256.Sum256([]byte(message))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	require.NoError(t, err)
	return base64.StdEncoding.EncodeToString(signature)
}

// TestVerifyWechatMessage 保护回调/应答验签契约：签名有效必须通过，
// 时间戳超窗、正文被篡改、签名非法必须拒绝。伪造回调会导致白送额度。
func TestVerifyWechatMessage(t *testing.T) {
	key := newTestRSAKey(t)
	body := []byte(`{"event_type":"TRANSACTION.SUCCESS"}`)

	now := strconv.FormatInt(time.Now().Unix(), 10)
	validSignature := signWechatMessage(t, key, now, "nonce-1", body)

	t.Run("有效签名通过", func(t *testing.T) {
		require.NoError(t, verifyWechatMessage(&key.PublicKey, now, "nonce-1", body, validSignature))
	})

	t.Run("正文被篡改拒绝", func(t *testing.T) {
		tampered := []byte(`{"event_type":"TRANSACTION.SUCCESS","extra":1}`)
		require.Error(t, verifyWechatMessage(&key.PublicKey, now, "nonce-1", tampered, validSignature))
	})

	t.Run("签名不匹配拒绝", func(t *testing.T) {
		otherKey := newTestRSAKey(t)
		otherSignature := signWechatMessage(t, otherKey, now, "nonce-1", body)
		require.Error(t, verifyWechatMessage(&key.PublicKey, now, "nonce-1", body, otherSignature))
	})

	t.Run("时间戳超窗拒绝", func(t *testing.T) {
		expired := strconv.FormatInt(time.Now().Add(-10*time.Minute).Unix(), 10)
		signature := signWechatMessage(t, key, expired, "nonce-1", body)
		err := verifyWechatMessage(&key.PublicKey, expired, "nonce-1", body, signature)
		require.ErrorIs(t, err, ErrWechatPayTimestampExpired)
	})

	t.Run("时间戳非法拒绝", func(t *testing.T) {
		require.Error(t, verifyWechatMessage(&key.PublicKey, "not-a-number", "nonce-1", body, validSignature))
	})

	t.Run("随机串为空拒绝", func(t *testing.T) {
		require.Error(t, verifyWechatMessage(&key.PublicKey, now, "", body, validSignature))
	})

	t.Run("签名非base64拒绝", func(t *testing.T) {
		require.Error(t, verifyWechatMessage(&key.PublicKey, now, "nonce-1", body, "!!!not-base64!!!"))
	})
}

// TestDecryptAESGCM 保护回调解密契约：微信侧用 APIv3 密钥做 AES-256-GCM，
// 解密实现必须能还原明文，且拒绝错误的 nonce 长度与关联数据。
func TestDecryptAESGCM(t *testing.T) {
	const (
		nonce          = "abcdefghijkl"
		associatedData = "transaction"
		plaintext      = `{"out_trade_no":"WX1Nabcdef1234567890"}`
	)

	block, err := aes.NewCipher([]byte(testAPIv3Key))
	require.NoError(t, err)
	aead, err := cipher.NewGCM(block)
	require.NoError(t, err)
	ciphertext := aead.Seal(nil, []byte(nonce), []byte(plaintext), []byte(associatedData))
	encoded := base64.StdEncoding.EncodeToString(ciphertext)

	t.Run("解密成功", func(t *testing.T) {
		got, err := decryptAESGCM(testAPIv3Key, nonce, associatedData, encoded)
		require.NoError(t, err)
		assert.Equal(t, plaintext, string(got))
	})

	t.Run("关联数据不符拒绝", func(t *testing.T) {
		_, err := decryptAESGCM(testAPIv3Key, nonce, "refund", encoded)
		require.Error(t, err)
	})

	t.Run("密钥错误拒绝", func(t *testing.T) {
		_, err := decryptAESGCM("00000000000000000000000000000000", nonce, associatedData, encoded)
		require.Error(t, err)
	})

	t.Run("nonce长度错误拒绝", func(t *testing.T) {
		_, err := decryptAESGCM(testAPIv3Key, "short", associatedData, encoded)
		require.ErrorContains(t, err, "nonce 长度")
	})

	t.Run("密文非base64拒绝", func(t *testing.T) {
		_, err := decryptAESGCM(testAPIv3Key, nonce, associatedData, "***")
		require.ErrorContains(t, err, "base64")
	})
}

// TestNormalizePem 保护管理员粘贴体验：微信证书工具生成的 PEM 在复制粘贴、
// 经 JSON 或环境变量传递后会失真，以下四种形态都必须能解析。
func TestNormalizePem(t *testing.T) {
	key := newTestRSAKey(t)
	multiLine := encodePrivateKeyPem(t, key)
	lines := strings.Split(strings.TrimSpace(multiLine), "\n")
	body := strings.Join(lines[1:len(lines)-1], "")

	cases := []struct {
		name string
		pem  string
	}{
		{name: "标准多行", pem: multiLine},
		{name: "换行被删空格保留", pem: lines[0] + body + lines[len(lines)-1]},
		{name: "所有空白被删", pem: strings.Join(strings.Fields(multiLine), "")},
		{name: "换行被转义", pem: strings.ReplaceAll(strings.TrimSpace(multiLine), "\n", `\n`)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parsed, err := parseRSAPrivateKey(tc.pem)
			require.NoError(t, err)
			assert.Equal(t, key.D, parsed.D)
		})
	}

	publicLines := strings.Split(strings.TrimSpace(encodePublicKeyPem(t, key)), "\n")
	publicSingleLine := publicLines[0] + strings.Join(publicLines[1:len(publicLines)-1], "") + publicLines[len(publicLines)-1]

	t.Run("公钥单行可解析", func(t *testing.T) {
		parsed, err := parseRSAPublicKey(publicSingleLine)
		require.NoError(t, err)
		assert.Equal(t, key.PublicKey.N, parsed.N)
	})
}

func TestParseRSAKeysRejectInvalidInput(t *testing.T) {
	_, err := parseRSAPrivateKey("not a pem at all")
	require.Error(t, err)

	_, err = parseRSAPublicKey("not a pem at all")
	require.Error(t, err)
}

// TestWechatMoneyToFen 保护金额换算边界：非法/非正金额必须报错而不是静默变 0，
// 否则会发出 0 元订单或 0 元退款。
func TestWechatMoneyToFen(t *testing.T) {
	cases := []struct {
		name    string
		money   float64
		want    int64
		wantErr bool
	}{
		{name: "整数元", money: 73, want: 7300},
		{name: "两位小数", money: 73.05, want: 7305},
		{name: "四舍五入", money: 0.005, want: 1},
		{name: "零非法", money: 0, wantErr: true},
		{name: "负数非法", money: -1, wantErr: true},
		{name: "过大非法", money: 1e18, wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := WechatMoneyToFen(tc.money)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}
