package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPasswordCipherIsOptIn 保护「没有显式配置稳定密钥时不落可逆副本」这一开关语义：
// 否则回落到每次启动随机生成的 SessionSecret，会让密文在重启后变成解不开的垃圾数据。
func TestPasswordCipherIsOptIn(t *testing.T) {
	original := passwordEncKey
	t.Cleanup(func() { passwordEncKey = original })

	t.Setenv("PASSWORD_ENC_KEY", "")
	t.Setenv("CRYPTO_SECRET", "")
	t.Setenv("SESSION_SECRET", "")
	passwordEncKey = nil
	InitPasswordEncryption()
	assert.Nil(t, passwordEncKey)

	encrypted, err := EncryptPassword("S3cret-Password")
	require.NoError(t, err)
	assert.Empty(t, encrypted)
	assert.Empty(t, DecryptPassword(encrypted))
}

// TestPasswordCipherRoundTrip 保护可逆存储本身：同一密钥下必须能还原明文，
// 且两次加密的密文不同（随机 nonce），否则同一批密码会以相同密文入库。
func TestPasswordCipherRoundTrip(t *testing.T) {
	original := passwordEncKey
	t.Cleanup(func() { passwordEncKey = original })

	t.Setenv("SESSION_SECRET", "unit-test-secret")
	InitPasswordEncryption()
	require.NotEmpty(t, passwordEncKey)

	encrypted, err := EncryptPassword("S3cret-Password")
	require.NoError(t, err)
	require.NotEmpty(t, encrypted)
	assert.NotContains(t, encrypted, "S3cret-Password")
	assert.Equal(t, "S3cret-Password", DecryptPassword(encrypted))

	other, err := EncryptPassword("S3cret-Password")
	require.NoError(t, err)
	assert.NotEqual(t, encrypted, other)
}

// TestDecryptPasswordRejectsUnreadableInput 保护读路径的降级行为：
// 更换密钥、数据损坏或为空时只能回显为空，绝不能返回脏数据或让调用方崩掉。
func TestDecryptPasswordRejectsUnreadableInput(t *testing.T) {
	original := passwordEncKey
	t.Cleanup(func() { passwordEncKey = original })

	t.Setenv("SESSION_SECRET", "unit-test-secret-a")
	InitPasswordEncryption()
	encrypted, err := EncryptPassword("S3cret-Password")
	require.NoError(t, err)

	t.Setenv("SESSION_SECRET", "unit-test-secret-b")
	InitPasswordEncryption()
	assert.Empty(t, DecryptPassword(encrypted))

	passwordEncKey = nil
	assert.Empty(t, DecryptPassword(encrypted))
	assert.Empty(t, DecryptPassword(""))
	assert.Empty(t, DecryptPassword("not-base64!!"))
}
