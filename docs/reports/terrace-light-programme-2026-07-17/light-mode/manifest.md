# Terrace light Programme capture manifest

- Candidate implementation: `f0a4ef6`
- Server: local optimized production build at `http://127.0.0.1:3049`
- Matrix: four surfaces × three widths × light theme × Chromium/WebKit = 24 images
- Surfaces: `/`, `/play`, `/play/draft`, `/play/review?run=resp-complete-a`
- Widths: `360×800`, `390×844`, `430×932`
- Chromium receipt SHA-256: `ebcd5a33c4ee8d94ca77461f5dfb2d64c0195652820e3caa37d542d6611ebb80`
- WebKit receipt SHA-256: `a463dd9144b3279d436c07de371068ccd7aa35516eb52dfa32e1682fc11f0904`
- Aggregate assertions: 24/24 metrics, zero axe violations, zero console errors, zero horizontal overflow, zero small targets.
- Harness note: Chromium passed under enforced CSP. The first WebKit run executed every geometry,
  paint, overflow, axe, and screenshot assertion but was red solely because the harness injects an
  inline style element that enforced CSP blocks. Per the named-environment rule, WebKit was rerun
  against the same optimized build with `WCDRAFT_CSP_REPORT_ONLY=1`; that named rerun passed 12/12.
- Visual inspection: representative captures for all four surfaces and both engines were manually
  inspected for paper/card hierarchy, legibility, preserved geometry, and paint completeness.

## Image SHA-256

### Chromium

| Surface      | Viewport | SHA-256                                                            |
| ------------ | -------- | ------------------------------------------------------------------ |
| draft setup  | 360×800  | `c5aeeceb0d92dc8e0baf3d7adc44770426db62f4409e0fa6fafeadeeac7b2e29` |
| draft setup  | 390×844  | `9cac61711035b8ee4094afe52e40a93f8dc3aba26048e88d4b5df6348a8d3b4e` |
| draft setup  | 430×932  | `9de6d8372326ed7b5c780533c7d393355db82e083128106649b889471923f840` |
| home         | 360×800  | `ca6b74d0ca9afed3cf45ddbe84de4231f10a0fa4963c44d8228d6e7130ff675d` |
| home         | 390×844  | `5acd50c31c349e9d18dc274770700752e4137e986041d48d8768be4c7fee8be2` |
| home         | 430×932  | `de90002ee4f15de61b5847474070ab1d1996eb334824291da6d6501101798e3f` |
| mode select  | 360×800  | `c3fcd741fb5ecb88907c8675d5e98374afe1e542a2b87e1f6f4ae0bccce5499c` |
| mode select  | 390×844  | `ac260461fd3b16cc85085dd6d5c372a2ce146cedc7154e470aaf5b2676fa3baa` |
| mode select  | 430×932  | `cb6f8cf9c6ee05abc1c70dcbb9a712bddebc5ee1cbb48eca40c2044495182f20` |
| squad review | 360×800  | `06dc5b8de7eb05460137fc1fc4cd889a17e9f8fb5c3f87797e37fc8e7be090ce` |
| squad review | 390×844  | `782eda219deab468ad1b681b756091e51d7b772863e56ed809a45f39c78891d6` |
| squad review | 430×932  | `f4ab1544451c5f29d9640602e5a99948e8c4cf4c26bf63e7d8e00b4efd46fc0e` |

### WebKit

| Surface      | Viewport | SHA-256                                                            |
| ------------ | -------- | ------------------------------------------------------------------ |
| draft setup  | 360×800  | `cca39b9f10dba56c3df7e0e2f50711cea5aca864d89c8f6af69c45564789c6bf` |
| draft setup  | 390×844  | `68bfcc91f0b95c17fd27eb3cd14b65e85d931593b202c04711179f7db61d3e71` |
| draft setup  | 430×932  | `b8b4cff082f0ba63fcac10085ee5ab595919ac1427066ea4dfea75e771f65796` |
| home         | 360×800  | `70489e8affdc7239ebfc10cb8c77b005f1c33f9e84fd74d3d64ec5880e8082f8` |
| home         | 390×844  | `32101ccb58423d57a763383d5dd93bf4f0b7a5d9be7d1cfa2a0a4342ff5e95e9` |
| home         | 430×932  | `8427458aebc07ff9fce702543934ccf237fb92e56ae1b67f47c08cc05be37d3a` |
| mode select  | 360×800  | `14fdd0dd23f21c757037d78c65eedafed49d095f9dc34c8e27f889cabba198e0` |
| mode select  | 390×844  | `ba4567b074a0358d569248417a1a56c0bd67946218fb31826b018cbdd3d43cc8` |
| mode select  | 430×932  | `e26fc17685ccbf5135b19bd4ca568e7f87b15931f6af2bdbbccfa1dafb253c3f` |
| squad review | 360×800  | `b175193bd352f05b7145fe3ae98e944baa0a2e0ef5b65bb192fa5e23b3440644` |
| squad review | 390×844  | `5f55dc79014ab37b126c7232c32018afdd67bd10035253eabd2f663c87d4c2a8` |
| squad review | 430×932  | `a4ba7009b0a9ce088e297bfd8cf2f350b2eabfa3d9f02640efcb59457ffc0860` |
