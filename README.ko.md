# Sabi

[![npm version](https://img.shields.io/npm/v/@vizuh/sabi)](https://www.npmjs.com/package/@vizuh/sabi)
[![license](https://img.shields.io/npm/l/@vizuh/sabi)](https://github.com/vizuh/sabi/blob/main/LICENSE)
[![CI](https://github.com/vizuh/sabi/actions/workflows/controller-ci.yml/badge.svg)](https://github.com/vizuh/sabi/actions)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

코딩 에이전트 궤적에 대한 적응형 라우팅.

Sabi는 코딩 하네스와 그 하네스가 호출할 수 있는 모델 사이에 위치합니다. 하네스는 자신의 루프, 도구, 권한, 기록, 승인을 유지합니다. Sabi는 도구 호출, 결과, 실패, 컨텍스트 압박, 기능, 제공자 상태 같은 궤적 증거를 사용해 다음 추론 또는 작업 전환을 무엇이 담당할지 선택합니다.

Sabi는 호스트에 구애받지 않는 라우팅 계층이며, 또 다른 에이전트 하네스나 편집기가 아닙니다. 어댑터는 각 호스트가 공개하는 실행 접점에 대한 선택적 다리입니다.

[English](README.md) · [Português (BR)](README.pt-BR.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어**

[설치](docs/install.md) · [통합](docs/adapters/README.md) · [증거](docs/harnesses.md) · [Agent 스킬](SKILL.md) · [머신 인덱스](llms.txt)

> [!TIP]
> Sabi에는 두 경계가 있습니다: 추론 라우팅(라운드별 모델/제공자 선택)과 controller 핸드오프(계속/위임/생성). hook 설치는 모델 전환의 증거가 아니고, 카탈로그 게시는 요금제 권한의 증거가 아니며, mock 통과는 절감 벤치마크가 아닙니다.

![Sabi 라우팅 구조: 호스트가 루프를 유지하고 어댑터가 호스트 이벤트를 변환하며 Sabi core가 라운드를 분류하고 증거를 기록](docs/images/sabi-routing.svg)

## Sabi를 한 번만 설치

Sabi는 사용자 범위로 설치합니다. worktree마다 설치하거나 설치 시 하네스를 고르지 않습니다.

Claude Code, Codex, controller 연동 OpenCode 워크플로에는 게시된 controller를 사용합니다:

~~~bash
npm install --global @vizuh/sabi-controller@0.1.0
sabi setup
sabi doctor
~~~

`@vizuh/sabi-controller` 패키지는 `controller-v0.1.0`으로 릴리스되어 있습니다. 로컬 Sabi 프록시를 거치는 Hermes나 OpenCode 추론에는 [체크아웃 기반 프록시 가이드](docs/install.md)를 사용하세요. controller 패키지가 설치하는 것은 hook과 데몬이며, 프록시 서버나 Hermes 프로필이 아닙니다.

사용자의 호스트 AI가 설치를 수행한다면 [호스트 AI 설치 플로](docs/install.ai.md)를 전달하세요. 하네스와 경로를 명시적으로 묻고, OpenRouter 키는 프록시 경로에서만 요청합니다. 자세한 설치 절차의 정본은 영어 문서입니다.

`setup`은 멱등합니다. 데몬과 상태를 사용자 범위로 유지하고, 지원 호스트를 감지하며, 지원되는 Sabi 소유 hook만 설치하고, Sabi를 사용할 수 없을 때도 정상 하네스 경로를 남깁니다. 호스트 설정을 바꾸지 않고 데몬만 원하면 `sabi setup --no-hooks`를 사용하세요.

설치 후에는 평소의 하네스를 엽니다. 선택적 통합은 그 기능이 필요할 때만 고르세요.

## 호스트 AI 또는 에이전트와 사용

설치하는 에이전트에게 [SKILL.md](SKILL.md)와 [머신 인덱스](llms.txt)를 전달하세요. 정본 [호스트 AI 플로](docs/install.ai.md)는 하네스와 경로를 명시적으로 묻고, 프록시 경로의 OpenRouter 키만 수집합니다. 설정은 `--language=en|pt-BR|zh-CN|ja|ko`를 받습니다. EN/PT-BR 이외의 대화형 프롬프트는 영어로 폴백합니다.

## 선택적 통합 고르기

| 목표 | 통합 | Sabi 역할 | 현재 경계 |
| --- | --- | --- | --- |
| 라운드별 모델+추론 effort 라우팅 | [Command Code mod](docs/adapters/command-code.md) | 호스트 네이티브 루프와 구독 카탈로그 사용 | Command Code만 |
| 내 자격 증명으로 모델/제공자 라우팅 | [로컬 프록시](docs/install.md#optional-integration-local-openai-compatible-proxy) | OpenAI 호환 엔드포인트로 전달 | 모델/제공자 라우팅만. 네이티브 reasoning-effort 전환 없음 |
| 세션과 worktree 간 작업 이동 | [Controller hook](docs/adapters/README.md) | 제한된 계속/위임/생성 동작 조율 | 기존 네이티브 세션 내 모델 전환 없음 |
| DeepSeek Harness에서 Sabi 사용 | [DeepSeek Harness 어댑터](docs/adapters/deepseek-harness.md) | DSH 네이티브 제공자 접점을 통해 `sabi/sabi-code` 추가 | 추론 전용. DSH 수명주기 지원은 아님 |
| 다른 호스트 추가 | [메인테이너 계약](docs/maintainers.md) | 어댑터 경계와 필요 증거 정의 | 어댑터는 두 번째 라우팅 정책을 만들지 않음 |

## 60초 멘털 모델

하나의 작업이 만드는 것은 하나의 요청이 아니라 궤적입니다:

~~~mermaid
flowchart LR
  H["Harness keeps its loop"] --> A["Adapter translates host events"]
  A --> S["Sabi core classifies the next round"]
  S --> M["Model/provider selected"]
  M --> H
  S --> E["Decision + evidence"]
~~~

**Command Code** 궤적은 이렇게 보입니다:

| Round | 증거 | 결정 |
| ---: | --- | --- |
| 1 | 새 지시 | 세션 모델 유지 |
| 2 | 저장소 검색과 읽기 | Cheap 티어 |
| 3 | 편집과 구현 | Mid 티어 |
| 4 | 테스트/빌드 | Mid 티어 |
| 5 | 실패한 도구 결과 | Strong 티어 |
| 6 | 실패 후 복구 | Strong 티어 |
| 7 | 검증 통과 | Mid 티어 |

프록시 클라이언트에서는 첫 요청이 `first-turn`으로 분류되어 설정된 티어(기본 mid)로 라우팅됩니다. 라운드 1을 세션 모델에 남기는 것은 Command Code 계속-턴 hook뿐입니다.

Sabi는 호스트가 공개하는 경계에서 결정합니다. 호스트 루프를 포크하거나, 도구를 재실행하거나, 권한을 몰래 다시 쓰지 않습니다.

## 실제 출하 범위

Sabi에는 현재 두 제품 계열이 있습니다:

1. **추론 어댑터.** Command Code 인프로세스 mod와 로컬 OpenAI 호환 프록시가 개별 추론 라운드를 라우팅합니다.
2. **Controller 어댑터.** controller는 지원 호스트 이벤트를 관찰하고, 호스트와 실행 영수증이 안전을 입증하는 경우에 제한된 대상으로 계속/위임/생성할 수 있습니다.

두 계열은 라우팅 개념과 core 타입을 공유하지만 호환되지 않습니다. Claude나 Codex hook은 네이티브 모델 전환의 증거가 아닙니다. 모델 카탈로그 게시는 요금제 권한의 증거가 아닙니다. 로컬 mock 테스트는 모델 품질이나 절감의 증거가 아닙니다.

지원은 층별로 보고합니다:

- 소스와 테스트는 어댑터가 존재하고 계약이 테스트됨을 보입니다.
- 프로토콜 테스트는 실제 클라이언트가 제한된 픽스처로 로컬 Sabi 엔드포인트나 호스트 접점에 도달했음을 보입니다.
- 라이브 스모크 테스트는 승인·인증된 upstream을 지출 상한 하에 실행했음을 보입니다.
- 완료-작업 평가는 고정 베이스라인 대비 품질과 비용을 측정합니다.

현재 증거와 한계는 [하네스 호환성](docs/harnesses.md)과 각 어댑터 페이지에 있습니다.

## 선택적 통합 상세

### Command Code 네이티브 통합

Command Code 궤적 안에서 모델과 reasoning effort를 바꾸고 싶을 때만 게시된 mod를 사용하세요:

~~~bash
cmd mods add -g npm:@vizuh/sabi-commandcode
cmd mods list
~~~

Sabi 제공자 키나 로컬 프록시가 필요 없습니다. mod는 세션에 이미 연결된 Command Code 구독을 사용합니다. 전체 검증과 요금제 적용 주의점은 [설치 및 보안](docs/install.md#optional-integration-command-code-native-mod)에 있습니다.

### OpenAI 호환 로컬 클라이언트

클라이언트가 `baseURL`을 받고 자신의 OpenRouter, Ollama 또는 기타 제공자 자격 증명으로 라우팅하고 싶을 때 프록시를 사용하세요. 이는 선택적 BYOK 추론 표면입니다. 그 모델/제공자 라우팅에는 Command Code mod의 네이티브 reasoning-effort 신호가 없습니다. [로컬 프록시](docs/install.md#optional-integration-local-openai-compatible-proxy)를 보세요.

현재 제로-가격 OpenRouter 품질 레인을 선택하려면 `OPENROUTER_API_KEY`(또는 설정된 Sabi secrets 파일)를 정하고 `sabi setup --free-quality`를 실행하세요. Sabi가 라이브 카탈로그를 새로고침하고 고정 `sabi-quality` 별칭을 추가해 검증 라운드를 그곳으로 보냅니다. 유료 티어는 유지됩니다. 카탈로그 새로고침은 가용성 증거이며, 모델 품질이나 프라이버시 보장이 아닙니다.

### 잉여 추론: 섀도 QA

Sabi는 구성된 제로-비용 고정 레인을 사용해 기본 작업을 바꾸지 않고 문제를 찾으러 갈 수 있습니다. 첫 조각은 명시적, 읽기 전용, 섀도 전용입니다:

~~~bash
sabi surplus inventory
sabi surplus review --intent=bug-hunt
sabi surplus history
~~~

로컬 Sabi 프록시를 통과하는 것은 제한된 추적 대상 diff뿐입니다. 비밀 경로, 비밀 유사 마커, 도구, 환경 값, 절대 경로는 거부됩니다. 영수증이 저장하는 것은 해시와 개수이며, diff나 모델 주장이 아닙니다. 주장은 결정적 검증기가 증명하기 전까지 자문으로 취급됩니다. [잉여 추론](docs/specs/surplus-inference.md)을 보세요.

### Controller hook

위에서 설치한 사용자-레벨 controller는 지원되는 Claude Code, Codex, OpenCode, Orca 워크플로를 조율할 수 있습니다. 이는 작업/세션 표면이며, 기존 호스트 세션 안의 모델을 일반적으로 다시 쓰는 방법이 아닙니다. 각 호스트의 증거와 경계는 [어댑터](docs/adapters/README.md)를 보세요.

Claude Code와 Codex는 각자의 구독으로 동작합니다. Sabi는 둘에 hook을 설치할 뿐, 제공자 base URL, API 키 또는 모델 오버라이드를 기록하지 않습니다. 둘에 대한 위임은 기존 구독을 넘는 비용을 만들지 않으며, Sabi의 동작이 둘을 종량제 지출로 바꿀 수도 없습니다.

`sabi updates`는 에이전트가 실행할 수 있는 업그레이드 전 검사입니다. 설치된 버전을 최근 npm 답변과 비교 보고하고, Node 버전, 프로젝트 설정, 설치된 hook 경로를 프리플라이트합니다. 캐시 읽기는 오프라인입니다. 레지스트리에 닿는 것은 `sabi updates --check`뿐이며, 한 번의 검사가 24시간 유효합니다. 스크립트용 `--json`도 있습니다.

## 라우팅 로직

결정적 정책은 먼저 현재 상태를 분류한 뒤 하드 제약을 적용하고 티어를 고릅니다:

~~~mermaid
flowchart TD
  I["Round state: tools, results, failures, context, media"] --> C["Classify"]
  C --> P["Apply capability + transport gates"]
  P --> D["Choose cheap / mid / strong"]
  D --> J{"Ambiguous?"}
  J -- "no" --> U["Forward through host/proxy"]
  J -- "yes" --> V["Optional Jev judge over valid choices"]
  V --> U
  U --> R["Record allowlisted evidence"]
~~~

기본 정책:

| 상황 | 규칙 | 기본 대상 |
| --- | --- | --- |
| 읽기/검색/잡무 | exploration | cheap |
| 편집/구현 | implementation | mid |
| 테스트/빌드/lint | verification | mid |
| 실패한 도구 결과 | failure | strong |
| 교착 또는 컨텍스트 압박 | stuck / context-pressure | mid |
| 속도 제한, 쿼터, 타임아웃 | transport | transport 티어. 무섭다고 강한 층으로 올리지 않음 |
| 이미지/파일 입력 | capability | 해당 모달리티를 선언한 첫 설정 티어 |
| 요청 출력이 선택 티어 상한 초과 | output-capacity | 요청 출력을 낼 수 있다고 *선언한* 가장 싼 티어 |

Jev는 모호한 프록시 라운드용 선택적 의미 판단입니다. 심판이지 워커 모델이 아닙니다. 타임아웃, 잘못된 답변, 자격 증명 없음은 결정적 정책으로 폴백합니다.

## 추산: 무엇을 개선할 수 있나

Sabi는 아직 보편적 절감 주장을 출하하지 않습니다. 다음은 체크인된 설정의 요금(USD/1M 토큰, 2026-09-18 검증)을 쓴 투명한 예시입니다. 캐시 할인, 제공자 최소 금액, 재시도, 선택적 judge 출력을 무시합니다. 예산에 쓰기 전 요금을 다시 확인하세요.

8라운드 작업을 가정합니다:

| 티어 | 라운드 | 라운드 평균 입력/출력 | 총 토큰 |
| --- | ---: | --- | ---: |
| Cheap | 3 | 3k / 1k | 12k |
| Mid | 4 | 5k / 2k | 28k |
| Strong | 1 | 8k / 3k | 11k |
| **합계** | **8** | n/a | **51k** |

예시 요금(cheap $0.06/$0.12, mid $0.20/$1.20, strong $2/$10)으로:

- 적응 믹스: 약 **$0.0605**.
- 같은 37k 입력+14k 출력을 all-strong으로: 약 **$0.2140**.
- all-strong 대비 예시 절감: **$0.1535 / 71.7%**.
- all-mid라면 약 **$0.0242**입니다. Sabi가 모든 작업에서 고정 mid를 이긴다고 주장하지 않습니다. 요점은 증거가 정당화하는 만큼만 strong 용량을 확보하는 것입니다.
- 이 단순 예시의 토큰 수는 여전히 **51k**입니다. Sabi가 바꾸는 것은 토큰에 붙는 가격과 역량이며, 컨텍스트나 도구 출력을 마법으로 지우지 않습니다.
- Strong 티어 점유율은 100%에서 토큰의 **21.6%**로 떨어집니다. 이는 라우팅 배분 추산이며, 품질 결과가 아닙니다.
- 설정 judge 요금 $0.042/M으로 6k-토큰 Jev 입력 1회는 judge 출력/통신비 전에 약 **$0.00025**를 더합니다. 라우팅 오버헤드는 리포트에서 별도 집계합니다.

정확한 식과 스프레드시트식 worked example은 [추산과 회계](docs/estimates.md)에 있습니다. 얻어야 할 제품 주장은 고정 완료-작업 집합에서 측정합니다: 완료 작업당 비용, 성공률, 에스컬레이션 정밀도, 레이턴시, 라우터/judge 오버헤드.

## 메인테이너용

Sabi는 호스트의 지원 확장점을 얇게 감싸는 어댑터로 설계되었습니다:

- 호스트 소유: 에이전트 루프, 도구, 승인, compaction, 재시도 정책, 사용자에게 보이는 모델 pin.
- 어댑터 수행: 감지, 세션 식별, 이벤트/요청 수신, 지원 접점 경유 디스패치, 결과 관찰, 깨끗한 제거.
- 모르는 역량은 모르는 채로 둡니다. Sabi는 도구, 파일, 이미지, 추론 필드, 구조적 출력을 버리는 대신 안전하지 않은 경로를 거부합니다.
- 라우팅 메타데이터는 로컬 attribution이며 권한 메커니즘이 아닙니다. Loopback이 기본입니다.
- 카탈로그 게시는 권한이 아니고, hook 설치는 라이브 라우팅이 아니며, mock 통과는 고객 벤치마크가 아닙니다.

계약, 증거 래더, 픽스처, 롤백 기대, 두 번째 정책을 만들지 않는 어댑터 제안법은 [메인테이너 가이드](docs/maintainers.md)를 보세요.

## 저장소 지도

~~~text
packages/core/                 shared state, policy, routing, telemetry
packages/server/               local OpenAI-compatible proxy
packages/adapters/             Command Code, DeepSeek Harness, Hermes, OpenCode, Orca, Prime Agent
packages/controller/           task/session controller and host hooks
packages/evals/                frozen evals, client smoke checks, accounting
docs/adapters/                 user-facing adapter guides
docs/research/                 verified upstream evidence and release gates
~~~

참고:

- [어댑터 디렉터리](docs/adapters/README.md)
- [하네스 증거](docs/harnesses.md)
- [설치 및 보안](docs/install.md)
- [메인테이너 가이드](docs/maintainers.md)
- [추산](docs/estimates.md)
- [결정과 경계](docs/decisions.md)

Sabi는 MIT 라이선스입니다. 저장소는 https://github.com/vizuh/sabi 에서 공개되어 있습니다.

## 커뮤니티와 보안

- [기여](CONTRIBUTING.md) — 기본 규칙, 검증 게이트, 릴리스 절차.
- [보안 정책](SECURITY.md) — 지원 버전과 취약점 비공개 보고.
- [결정과 경계](docs/decisions.md) — 결정한 것, 명시적으로 주장하지 않는 것.
- [하네스 증거](docs/harnesses.md) — 증거 층별로 보고하는 어댑터별 지원.

## 접근성

- 이미지에 대체 텍스트가 있습니다. 색상에만 의미를 두지 않습니다.
- 제목 순서를 지키고 표에는 헤더 행이 있습니다.
- 링크 텍스트는 목적지를 밝힙니다(“여기” 단독 사용 금지).
- 영어가 정본입니다. 요금·쿼터·지원 주장은 영어판을 따릅니다.
