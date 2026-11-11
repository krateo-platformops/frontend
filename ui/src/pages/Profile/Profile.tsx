import { Avatar, Card, Col, Descriptions, Row, Space, Typography } from 'antd'
import { useEffect, useState } from 'react'

import styles from './Profile.module.css'

type UserData = {
  user: {
    avatarURL: string
    displayName: string
    username: string
    email: string
  }
  groups: string[]
} | undefined

const Profile = () => {
  const lsUserData = localStorage.getItem('K_user')
  const [userData, setUserData] = useState<UserData>(undefined)

  useEffect(() => {
    if (!lsUserData) {
      window.location.replace('/login')
    } else {
      setUserData(JSON.parse(lsUserData) as UserData)
    }
  }, [lsUserData])

  // Content-only: the shell chrome comes from the Shell layout route (Profile is
  // one of its child routes), so this renders just the profile card.
  return (
    <Card>
      <Row>
        <Col className={styles.avatar} md={8} sm={24}>
          <Avatar size={200} src={userData?.user.avatarURL || undefined} />
        </Col>
        <Col md={16} sm={24}>
          <Space direction='vertical' size='large'>
            <div>
              <Typography.Text className={styles.fullname}>{userData?.user.displayName}</Typography.Text>
              <a className={styles.email} href={`mailto:${userData?.user.email}`}>{userData?.user.email}</a>
            </div>

            <Descriptions column={1}>
              <Descriptions.Item label='Username'>
                {userData?.user.username}
              </Descriptions.Item>
              <Descriptions.Item label='Groups'>
                {userData?.groups.join(', ')}
              </Descriptions.Item>
            </Descriptions>
          </Space>
        </Col>
      </Row>
    </Card>
  )
}

export default Profile
