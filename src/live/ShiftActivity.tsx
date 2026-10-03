/**
 * 排班实时活动（灵动岛 / 锁屏倒计时）
 *
 * ⚠️ 这个文件里的组件带 `'widget'` 指令，会被打包成【独立 JS bundle】，
 * 在 widget 扩展的隔离运行时里执行。因此：
 *   - 只能用 @expo/ui/swift-ui 的组件与 modifier，
 *     不能用 react-native 的 View/Text
 *   - 不能用任何 Hook、状态、context，也不能做异步
 *   - 【不能引用函数外的任何东西】（模块级常量在运行时不存在），
 *     所有常量/辅助都必须写在函数体内部
 *
 * 倒计时用 Text 的 timerInterval + countsDown 实现 ——
 * 这是 SwiftUI 原生的自更新时间器，不需要 App 侧不停 update。
 */
import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type ShiftActivityProps = {
  /** 项目名称 */
  title: string;
  /** 排班内容（可能为空） */
  content: string;
  /** 开始时间（毫秒时间戳） */
  startAt: number;
  /** 结束时间（毫秒时间戳） */
  endAt: number;
  /** 服务地点（可能为空） */
  place: string;
};

const ShiftActivity = (props: ShiftActivityProps, environment: LiveActivityEnvironment) => {
  'widget';

  // 所有取值都必须在函数内完成（模块级常量在 widget 运行时里不存在）
  const accent = environment.isLuminanceReduced ? '#FFFFFF' : '#2E7D32';
  const dim = environment.colorScheme === 'dark' ? '#B9C4CF' : '#5B6672';
  const range = { lower: new Date(props.startAt), upper: new Date(props.endAt) };
  const started = Date.now() >= props.startAt && Date.now() < props.endAt;

  return {
    /* ---------------------------------------------------- 锁屏主视图 */
    banner: (
      <VStack modifiers={[padding({ all: 14 })]}>
        <HStack>
          <Image systemName="hands.sparkles.fill" color={accent} />
          <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(accent)]}>
            {props.title}
          </Text>
          <Spacer />
        </HStack>

        <Text modifiers={[font({ size: 11 }), foregroundStyle(dim)]}>
          {props.content || (started ? '服务进行中' : '即将开始')}
        </Text>

        {/* 原生自更新的倒计时 */}
        <Text
          timerInterval={range}
          countsDown
          modifiers={[font({ weight: 'bold', size: 26 }), foregroundStyle(accent)]}
        />

        <ProgressView timerInterval={range} countsDown />

        <Text modifiers={[font({ size: 10 }), foregroundStyle(dim)]}>
          {new Date(props.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          {' – '}
          {new Date(props.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </VStack>
    ),

    /* ---------------------------------------------------- 灵动岛：紧凑态 */
    compactLeading: <Image systemName="hands.sparkles.fill" color={accent} />,
    compactTrailing: (
      <Text timerInterval={range} countsDown modifiers={[font({ size: 12 }), foregroundStyle(accent)]} />
    ),

    /* ---------------------------------------------------- 灵动岛：最小态 */
    minimal: <Image systemName="hands.sparkles.fill" color={accent} />,

    /* ---------------------------------------------------- 灵动岛：展开态 */
    expandedLeading: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Image systemName="hands.sparkles.fill" color={accent} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(dim)]}>志愿服务</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Text
          timerInterval={range}
          countsDown
          modifiers={[font({ weight: 'bold', size: 20 }), foregroundStyle(accent)]}
        />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(dim)]}>剩余</Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Text modifiers={[font({ weight: 'bold', size: 13 })]}>{props.title}</Text>
        {props.content ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(dim)]}>{props.content}</Text>
        ) : null}
        {props.place ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(dim)]}>地点：{props.place}</Text>
        ) : null}
      </VStack>
    ),
  };
};

/**
 * 名字必须和这个调用一致即可，**不需要**在 app.json 的 widgets[] 里登记
 * （官方文档明确：createLiveActivity 在运行时注册，库自带 target 渲染）。
 */
export default createLiveActivity('ShiftActivity', ShiftActivity);
