import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'

// 设置 inclusive: false，使得在着色文本末尾输入时不继承颜色
export const CustomTextStyle = TextStyle.extend({
  inclusive: false,
})

export const CustomColor = Color.configure({
  types: ['textStyle'],
})

export { CustomTextStyle as TextStyle, CustomColor as Color }
