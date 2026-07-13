import { access, cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const source = path.resolve('../public/icon.png')
const targetDir = path.resolve('public')
const target = path.join(targetDir, 'icon.png')

await mkdir(targetDir, { recursive: true })
await access(source)
await cp(source, target)
console.log('Cloud dashboard assets ready.')
