import { Link } from 'react-router-dom';
import './chatList.css'

const ChatList =() => {
    return(
        <div className='chatList'>
           <span className='title'>DASHBOARD</span>
           <Link to ="/dashboard/chats/id">
           Create a new Chat
           </Link>
           
           <hr/>
           <span className='title'>Recent Chats</span>
 

           <hr/>
           

        </div>
    )
}

export default  ChatList ;