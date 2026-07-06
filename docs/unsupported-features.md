# Unsupported or Deferred Features

## Explicit MVP rejections

The relay should reject these cases clearly instead of pretending they are supported:

- Cross-provider translation of provider-native tools
- Guaranteed lossless reasoning/thinking block translation
- Guaranteed multimodal file/image translation across providers
- Multi-tenant policy enforcement
- Automatic failover or cost-aware routing decisions

## Same-provider behavior vs cross-provider behavior

- **Same-provider path**: provider-specific extensions may be preserved under provider namespaces where implementation allows.
- **Cross-provider path**: unsupported provider-native features should produce an `UnsupportedFeatureError`.

## Error posture

The default policy is to fail explicitly when a request depends on a feature that is not implemented or is known to be lossy beyond the documented contract.
